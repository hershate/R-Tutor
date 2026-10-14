package tutor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// websearch.go is the production Searcher: two Bing engines (paid API when
// a key is configured, the free web page otherwise), complexity-aware
// quotas, SSRF-guarded verification, and the mandatory LLM relevance gate.

const (
	searchTimeout       = 30 * time.Second
	bingWebTimeout      = 15 * time.Second
	bingWebMaxBytes     = 2 << 20
	maxQueryChars       = 150
	searchConcurrency   = 2
	verifyConcurrency   = 4
	screenMaxAttempts   = 2
	screenTokensCap     = 8000
	screenTokensBase    = 500
	screenTokensPerItem = 100
	baseTotalCap        = 20
	hardTotalCap        = 50
	hardStageCap        = 7
	defaultStageCap     = 5
)

var (
	bingWebEndpoint = "https://cn.bing.com/search"
	bingAPIEndpoint = "https://api.bing.microsoft.com/v7.0/search"
	bingWebHeaders  = map[string]string{
		"User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
		"Accept":          "text/html,application/xhtml+xml",
		"Accept-Language": "zh-CN,zh;q=0.9",
	}
	bingItemRe = regexp.MustCompile(`<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>`)
	anyTagOnly = regexp.MustCompile(`<[^>]+>`)
)

// searchCandidate is one engine hit.
type searchCandidate struct {
	Title string
	URL   string
}

// screenMaxTokens sizes the gate's output budget by candidate count; a fixed
// cap truncates busy replies into unparseable JSON and drops everything.
func screenMaxTokens(candidates int) int {
	return min(screenTokensCap, screenTokensPerItem*candidates+screenTokensBase)
}

// WebSearcher drives the engines, the verifier and the screening gate. The
// provider is resolved per run so a model switch applies to screening too.
type WebSearcher struct {
	Engine    string // "", "auto", "bing" or "bing_web"
	APIKey    string
	Provider  func() (LLM, error)
	Pricer    Pricer
	MaxTokens int
	// Endpoints and guard are seams for tests; production leaves them zero.
	WebEndpoint string
	APIEndpoint string
	AllowHost   func(rawURL string) error
}

// verifyGuard is the SSRF check applied per hop; tests swap it to admit
// loopback fixtures.
var verifyGuard = requirePublicURL

func (w *WebSearcher) guard(rawURL string) error {
	if w.AllowHost != nil {
		return w.AllowHost(rawURL)
	}
	return verifyGuard(rawURL)
}

func (w *WebSearcher) webEndpoint() string {
	if w.WebEndpoint != "" {
		return w.WebEndpoint
	}
	return bingWebEndpoint
}

func (w *WebSearcher) apiEndpoint() string {
	if w.APIEndpoint != "" {
		return w.APIEndpoint
	}
	return bingAPIEndpoint
}

// effectiveEngine applies Deep-tutor's iter-346 semantics: without a key both
// auto and bing fall back to the free web engine rather than going silent.
func (w *WebSearcher) effectiveEngine() string {
	switch strings.ToLower(strings.TrimSpace(w.Engine)) {
	case "bing_web":
		return "bing_web"
	case "bing":
		if w.APIKey != "" {
			return "bing_api"
		}
		return "bing_web"
	default: // auto, ""
		if w.APIKey != "" {
			return "bing_api"
		}
		return "bing_web"
	}
}

// searchJob is one engine call: a topic for one stage with its candidate
// count, which difficulty raises.
type searchJob struct {
	stageIndex int
	topic      string
	count      int
}

// SearchOutcome carries the keepers plus the warnings a person should see.
type SearchOutcome struct {
	Resources []Resource
	Note      string
	Engine    string
	Usage     Usage // the screening gate's metered spend
}

// stageResourceCap: harder stages cite more (2+difficulty, capped).
func stageResourceCap(difficulty int) int {
	if difficulty <= 0 {
		return defaultStageCap
	}
	return min(2+difficulty, hardStageCap)
}

func totalResourceCap(nodes int) int {
	return min(baseTotalCap+max(nodes, 0), hardTotalCap)
}

func stageTopicCap(difficulty int) int {
	if difficulty >= 4 {
		return 4
	}
	return 3
}

// stageTopics derives per-stage query lists, in order, deduplicated.
func stageTopics(stages []Stage) [][]string {
	out := make([][]string, 0, len(stages))
	for _, st := range stages {
		var names []string
		seen := map[string]bool{}
		for _, t := range st.Topics {
			name := strings.TrimSpace(t.Name)
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			names = append(names, name)
		}
		out = append(out, names)
	}
	return out
}

func (w *WebSearcher) engineSearch(ctx context.Context, engine, query string, count int) ([]searchCandidate, error) {
	query = truncateRunes(query, maxQueryChars)
	if query == "" {
		return nil, nil
	}
	client := &http.Client{Timeout: bingWebTimeout}
	if engine == "bing_api" {
		client.Timeout = searchTimeout
		return w.bingAPI(ctx, client, query, count)
	}
	return w.bingWeb(ctx, client, query, count)
}

// bingWeb scrapes the free search page: Chrome headers, a 2MB cap, and a
// captcha/shell check so a blocked page is an error, not zero results.
func (w *WebSearcher) bingWeb(ctx context.Context, client *http.Client, query string, count int) ([]searchCandidate, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, w.webEndpoint(), nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", query)
	q.Set("count", fmt.Sprint(count))
	q.Set("mkt", "zh-CN")
	req.URL.RawQuery = q.Encode()
	for k, v := range bingWebHeaders {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bing web status %d", resp.StatusCode)
	}
	if host := resp.Request.URL.Hostname(); !strings.HasSuffix(host, "bing.com") && !strings.HasSuffix(host, w.hostOverrideSuffix()) {
		return nil, fmt.Errorf("redirected off bing: %s", host)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, bingWebMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > bingWebMaxBytes {
		return nil, errors.New("tutor: bing page exceeds cap")
	}
	page := string(body)
	if !strings.Contains(page, "b_results") || strings.Contains(page, "b_captcha") {
		return nil, errors.New("tutor: bing served a captcha page")
	}
	return parseBingItems(page, count), nil
}

// hostOverrideSuffix admits a test endpoint's host in the redirect check.
func (w *WebSearcher) hostOverrideSuffix() string {
	if w.WebEndpoint == "" {
		return ""
	}
	if u, err := url.Parse(w.WebEndpoint); err == nil {
		return u.Hostname()
	}
	return ""
}

func parseBingItems(page string, count int) []searchCandidate {
	var out []searchCandidate
	seen := map[string]bool{}
	for _, m := range bingItemRe.FindAllStringSubmatch(page, -1) {
		rawURL, rawTitle := m[1], m[2]
		if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
			continue
		}
		if strings.Contains(rawURL, "bing.com/ck/a") {
			continue
		}
		if seen[rawURL] {
			continue
		}
		seen[rawURL] = true
		title := strings.TrimSpace(anyTagOnly.ReplaceAllString(rawTitle, ""))
		if r := []rune(title); len(r) > 200 {
			title = string(r[:200])
		}
		out = append(out, searchCandidate{Title: title, URL: rawURL})
		if len(out) >= count {
			break
		}
	}
	return out
}

// bingAPI queries the paid Bing Search API.
func (w *WebSearcher) bingAPI(ctx context.Context, client *http.Client, query string, count int) ([]searchCandidate, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, w.apiEndpoint(), nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("q", query)
	q.Set("count", fmt.Sprint(count))
	req.URL.RawQuery = q.Encode()
	req.Header.Set("Ocp-Apim-Subscription-Key", w.APIKey)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bing api status %d", resp.StatusCode)
	}
	var payload struct {
		WebPages struct {
			Value []struct {
				Name string `json:"name"`
				URL  string `json:"url"`
			} `json:"value"`
		} `json:"webPages"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, bingWebMaxBytes)).Decode(&payload); err != nil {
		return nil, err
	}
	var out []searchCandidate
	for _, item := range payload.WebPages.Value {
		out = append(out, searchCandidate{Title: item.Name, URL: item.URL})
		if len(out) >= count {
			break
		}
	}
	return out, nil
}

// Search implements Searcher with Deep-tutor's full pipeline.
func (w *WebSearcher) Search(ctx context.Context, q ResourceQuery) (SearchOutcome, error) {
	outcome := SearchOutcome{Engine: w.effectiveEngine()}
	engine := outcome.Engine
	// The gate is mandatory: without a model there is no honest way to hand
	// out web citations, so the searcher stays empty rather than unscreened.
	llm, llmErr := w.provider()
	if llmErr != nil || llm == nil {
		outcome.Note = "未配置模型服务，本次未检索网络资源（引文必须经 AI 相关性筛选）"
		return outcome, nil
	}

	perStageJobs := map[int]int{}
	var jobs []searchJob
	for stageIndex, topics := range stageTopics(q.Stages) {
		difficulty := 0
		if stageIndex < len(q.Stages) {
			difficulty = q.Stages[stageIndex].Difficulty
		}
		limit := stageTopicCap(difficulty)
		candCount := 5
		if difficulty > 0 {
			candCount = min(3+difficulty, 8)
		}
		for _, topic := range topics {
			if perStageJobs[stageIndex] >= limit {
				break
			}
			jobs = append(jobs, searchJob{stageIndex: stageIndex, topic: topic, count: candCount})
			perStageJobs[stageIndex]++
		}
	}
	results := w.runQueries(ctx, engine, jobs)
	succeeded := 0
	for _, r := range results {
		if r != nil {
			succeeded++
		}
	}
	if len(jobs) > 0 && succeeded == 0 {
		outcome.Note = fmt.Sprintf("检索引擎（%s）不可用，未获得结果；请人工补充资源", engine)
		return outcome, nil
	}

	type stagedCandidate struct {
		stageIndex int
		candidate  searchCandidate
	}
	var pool []stagedCandidate
	firstStage := map[string]int{}
	for i, job := range jobs {
		if results[i] == nil {
			continue
		}
		for _, cand := range results[i] {
			if cand.URL == "" {
				continue
			}
			if _, seen := firstStage[cand.URL]; !seen {
				firstStage[cand.URL] = job.stageIndex
				pool = append(pool, stagedCandidate{stageIndex: job.stageIndex, candidate: cand})
			}
		}
	}
	verdicts := w.verifyAll(ctx, firstStage)

	var resources []Resource
	perStage := map[int]int{}
	for _, item := range pool {
		if len(resources) >= totalResourceCap(q.Nodes) {
			break
		}
		difficulty := 0
		if item.stageIndex < len(q.Stages) {
			difficulty = q.Stages[item.stageIndex].Difficulty
		}
		if perStage[item.stageIndex] >= stageResourceCap(difficulty) {
			continue
		}
		verdict := verdicts[item.candidate.URL]
		if verdict.Label == "invalid" || verdict.Label == "" {
			continue
		}
		resources = append(resources, Resource{
			StageIndex: item.stageIndex,
			Title:      item.candidate.Title,
			URL:        verdict.FinalURL,
			Type:       "doc",
			Verified:   VerifyLabel(verdict.Label),
			Note:       "",
			Snippet:    verdict.Snippet,
		})
		perStage[item.stageIndex]++
	}
	if len(resources) == 0 {
		return outcome, nil
	}

	screened, note, usage := w.screen(ctx, llm, q, resources)
	outcome.Resources = screened
	outcome.Note = note
	outcome.Usage = usage
	for i := range outcome.Resources {
		outcome.Resources[i].Snippet = ""
	}
	return outcome, nil
}

func (w *WebSearcher) provider() (LLM, error) {
	if w.Provider == nil {
		return nil, errors.New("tutor: no llm provider")
	}
	return w.Provider()
}

// runQueries fans the engine calls out at the searched-for concurrency,
// keeping each failure local: one dead topic never kills the batch.
func (w *WebSearcher) runQueries(ctx context.Context, engine string, jobs []searchJob) [][]searchCandidate {
	results := make([][]searchCandidate, len(jobs))
	sem := make(chan struct{}, searchConcurrency)
	var wg sync.WaitGroup
	for i, job := range jobs {
		wg.Add(1)
		go func(i int, topic string, count int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			found, err := w.engineSearch(ctx, engine, topic, count)
			if err == nil {
				results[i] = found
			}
		}(i, job.topic, job.count)
	}
	wg.Wait()
	return results
}

// verifyAll checks the deduplicated candidate URLs concurrently.
func (w *WebSearcher) verifyAll(ctx context.Context, firstStage map[string]int) map[string]verifyVerdict {
	urls := make([]string, 0, len(firstStage))
	for u := range firstStage {
		urls = append(urls, u)
	}
	sort.Strings(urls)
	verdicts := make(map[string]verifyVerdict, len(urls))
	sem := make(chan struct{}, verifyConcurrency)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, rawURL := range urls {
		wg.Add(1)
		go func(rawURL string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			client := &http.Client{Timeout: verifyTimeout}
			verdict := verifyURL(ctx, client, rawURL, w.guard)
			mu.Lock()
			verdicts[rawURL] = verdict
			mu.Unlock()
		}(rawURL)
	}
	wg.Wait()
	return verdicts
}

func truncateRunes(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > n {
		return string(r[:n])
	}
	return string(r)
}
