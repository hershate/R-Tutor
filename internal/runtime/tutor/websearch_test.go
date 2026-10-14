package tutor

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func allowAll(string) error { return nil }

func bingResultsPage(items string) string {
	return "<html><body><ol id=\"b_results\">" + items + "</ol></body></html>"
}

func bingItem(href, title string) string {
	return fmt.Sprintf(`<li class="b_algo"><h2 class=" b_topTitle"><a href="%s" h="ID=SERP">%s</a></h2></li>`, href, title)
}

func newBingFixture(t *testing.T, targets *httptest.Server) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/search", func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Query().Get("q"), "empty") {
			w.Write([]byte(bingResultsPage("")))
			return
		}
		items := bingItem(targets.URL+"/ok/react", "React 官方教程") +
			bingItem(targets.URL+"/ok/hooks", "Hooks 指南") +
			bingItem("https://www.bing.com/ck/a?form=BEHPTB", "跳转壳应被剔除") +
			bingItem("javascript:void(0)", "非 http 链接应被剔除") +
			bingItem(targets.URL+"/gone", "死链") +
			bingItem(targets.URL+"/ok/react", "React 官方教程")
		w.Write([]byte(bingResultsPage(items)))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

// newVerifyTargets serves the pages candidates land on.
func newVerifyTargets(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	long := strings.Repeat("React 学习笔记的内容，", 100)
	mux.HandleFunc("/ok/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<html><body><p>"+long+"</p></body></html>")
	})
	mux.HandleFunc("/short", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "tiny")
	})
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<html><body>"+long+"<div>please complete the captcha to continue</div></body></html>")
	})
	mux.HandleFunc("/hop", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ok/react", http.StatusFound)
	})
	mux.HandleFunc("/gone", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func TestBingWebParsesAndFilters(t *testing.T) {
	targets := newVerifyTargets(t)
	bing := newBingFixture(t, targets)
	w := &WebSearcher{WebEndpoint: bing.URL + "/search"}
	got, err := w.engineSearch(context.Background(), "bing_web", "react 入门", 8)
	if err != nil {
		t.Fatalf("engineSearch: %v", err)
	}
	var urls []string
	for _, c := range got {
		urls = append(urls, c.URL)
	}
	// dedup keeps one react hit; ck/a and javascript: links never appear.
	if len(got) != 3 {
		t.Fatalf("candidates = %v", urls)
	}
	for _, u := range urls {
		if strings.Contains(u, "bing.com/ck/a") || strings.HasPrefix(u, "javascript") {
			t.Fatalf("filtered link leaked: %v", urls)
		}
	}
	if got[0].Title != "React 官方教程" {
		t.Fatalf("title = %q", got[0].Title)
	}
}

func TestBingWebCaptchaIsAnError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<html><div class=\"b_captcha\">verify</div></html>"))
	}))
	defer server.Close()
	w := &WebSearcher{WebEndpoint: server.URL}
	if _, err := w.engineSearch(context.Background(), "bing_web", "react", 5); err == nil {
		t.Fatal("captcha page accepted as results")
	}
}

func TestBingAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Ocp-Apim-Subscription-Key") != "k-1" {
			http.Error(w, "no key", http.StatusUnauthorized)
			return
		}
		fmt.Fprint(w, `{"webPages":{"value":[{"name":"React 教程","url":"https://react.dev/learn"}]}}`)
	}))
	defer server.Close()
	w := &WebSearcher{APIEndpoint: server.URL, APIKey: "k-1"}
	got, err := w.engineSearch(context.Background(), "bing_api", "react", 5)
	if err != nil {
		t.Fatalf("engineSearch: %v", err)
	}
	if len(got) != 1 || got[0].URL != "https://react.dev/learn" {
		t.Fatalf("candidates = %+v", got)
	}
}

func TestVerifyURLVerdicts(t *testing.T) {
	targets := newVerifyTargets(t)
	client := &http.Client{}
	cases := []struct {
		path string
		want string
	}{
		{"/ok/react", "ok"},
		{"/short", "uncertain"},
		{"/login", "uncertain"},
		{"/hop", "ok"}, // redirect followed to /ok
		{"/gone", "invalid"},
	}
	for _, tc := range cases {
		verdict := verifyURL(context.Background(), client, targets.URL+tc.path, allowAll)
		if verdict.Label != tc.want {
			t.Errorf("%s label = %q (reason %q), want %q", tc.path, verdict.Label, verdict.Reason, tc.want)
		}
	}
	ok := verifyURL(context.Background(), client, targets.URL+"/ok/react", allowAll)
	if !strings.Contains(ok.Snippet, "React") {
		t.Errorf("snippet = %q", ok.Snippet)
	}
	if _, cached := sharedVerifyCache.get(targets.URL + "/ok/react"); !cached {
		t.Error("verdict was not cached for the next caller")
	}
}

func TestSSRFGuardStillApplies(t *testing.T) {
	if err := requirePublicURL("http://169.254.169.254/latest/meta-data"); err == nil {
		t.Fatal("metadata endpoint allowed")
	}
	if err := requirePublicURL("http://127.0.0.1/x"); err == nil {
		t.Fatal("loopback allowed")
	}
	if err := requirePublicURL("ftp://example.com/f"); err == nil {
		t.Fatal("non-http scheme allowed")
	}
}

func TestRobotsPermits(t *testing.T) {
	body := `User-agent: *
Disallow: /private/
Disallow:

User-agent: Reasonix-Tutor
Disallow: /tutor-only/`
	if !robotsPermits([]byte(body), "/learn/page") {
		t.Error("plain path should be permitted")
	}
	if robotsPermits([]byte(body), "/tutor-only/x") {
		t.Error("agent-specific rule ignored")
	}
	if robotsPermits([]byte(body), "/private/x") {
		t.Error("star-group disallow must still bind even when an agent group exists")
	}
}

func TestScreenParsingAndKeys(t *testing.T) {
	verdicts := parseScreenVerdicts("```json\n[{\"url\":\"https://a.dev/\",\"suitable\":\"yes\",\"label\":\"ok\"},{\"url\":\"https://b.dev/x#frag\",\"suitable\":0,\"label\":\"uncertain\",\"note\":\"过深\"}]\n```")
	if verdicts == nil {
		t.Fatal("verdicts nil")
	}
	if !verdicts["https://a.dev/"].Suitable || verdicts["https://a.dev/"].Label != VerifyOK {
		t.Fatalf("a verdict = %+v", verdicts["https://a.dev/"])
	}
	if verdicts["https://b.dev/x#frag"].Suitable || verdicts["https://b.dev/x#frag"].Note != "过深" {
		t.Fatalf("b verdict = %+v", verdicts["https://b.dev/x#frag"])
	}
	if parseScreenVerdicts("no json here") != nil {
		t.Fatal("garbage parsed")
	}
	if screenURLKey("HTTPS://A.DEV/x#f") != screenURLKey("https://a.dev/x/") {
		t.Fatalf("keys differ: %q vs %q", screenURLKey("HTTPS://A.DEV/x#f"), screenURLKey("https://a.dev/x/"))
	}
}

// newScreenLLM approves every URL it is asked about, optionally with edits.
func newScreenLLM(reply func(candidates string) string) *fakeLLM {
	return &fakeLLM{reply: func(system string, call int) string {
		_ = system
		return reply("candidates")
	}}
}

func TestWebSearcherEndToEndKeepsScreened(t *testing.T) {
	targets := newVerifyTargets(t)
	bing := newBingFixture(t, targets)
	screened := newScreenLLM(func(string) string {
		return `[{"url":"` + targets.URL + `/ok/react","suitable":true,"label":"ok","note":""},` +
			`{"url":"` + targets.URL + `/ok/hooks","suitable":true,"label":"uncertain","note":"深度存疑"}]`
	})
	w := &WebSearcher{
		WebEndpoint: bing.URL + "/search",
		AllowHost:   allowAll,
		Provider:    func() (LLM, error) { return screened, nil },
	}
	query := ResourceQuery{
		Topic: "React", Level: "零基础",
		Stages: []Stage{{Index: 0, Name: "入门", Difficulty: 1, Topics: []StageTopic{{Name: "react 入门"}}}},
		Nodes:  2,
	}
	outcome, err := w.Search(context.Background(), query)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if outcome.Engine != "bing_web" {
		t.Fatalf("engine = %q", outcome.Engine)
	}
	// gone 死链被换源剔除，ck/a 壳剔除，去重后 2 条全过门。
	if len(outcome.Resources) != 2 {
		t.Fatalf("resources = %+v", outcome.Resources)
	}
	for _, r := range outcome.Resources {
		if r.Snippet != "" {
			t.Fatalf("snippet leaked into result: %+v", r)
		}
		if r.Verified == VerifyUncertain && r.Note != "深度存疑" {
			t.Fatalf("gate note lost: %+v", r)
		}
	}
}

func TestWebSearcherDropsAllWhenScreenFails(t *testing.T) {
	targets := newVerifyTargets(t)
	bing := newBingFixture(t, targets)
	broken := &fakeLLM{reply: func(string, int) string { return "not json" }}
	w := &WebSearcher{
		WebEndpoint: bing.URL + "/search",
		AllowHost:   allowAll,
		Provider:    func() (LLM, error) { return broken, nil },
	}
	outcome, err := w.Search(context.Background(), ResourceQuery{
		Topic:  "React",
		Stages: []Stage{{Index: 0, Difficulty: 1, Topics: []StageTopic{{Name: "react 入门"}}}},
	})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(outcome.Resources) != 0 {
		t.Fatalf("unscreened resources kept: %+v", outcome.Resources)
	}
	if outcome.Note == "" {
		t.Fatal("gate failure should explain itself")
	}
}

func TestWebSearcherNoProviderStaysEmpty(t *testing.T) {
	w := &WebSearcher{Provider: func() (LLM, error) { return nil, ErrNoLLM }}
	outcome, err := w.Search(context.Background(), ResourceQuery{Topic: "x"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(outcome.Resources) != 0 || outcome.Note == "" {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestSearchQuotas(t *testing.T) {
	if got := stageResourceCap(0); got != defaultStageCap {
		t.Errorf("stageResourceCap(0) = %d", got)
	}
	if got := stageResourceCap(5); got != hardStageCap {
		t.Errorf("stageResourceCap(5) = %d", got)
	}
	if got := totalResourceCap(100); got != hardTotalCap {
		t.Errorf("totalResourceCap(100) = %d", got)
	}
	if got := stageTopicCap(4); got != 4 {
		t.Errorf("stageTopicCap(4) = %d", got)
	}
}
