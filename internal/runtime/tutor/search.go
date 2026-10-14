package tutor

import (
	"strings"
	"unicode/utf8"
)

// search.go — the tutor's global search, Deep-tutor's /search endpoint:
// one substring query answered across plans, knowledge nodes, notes, and
// KB documents. Pure file reads, no LLM, nothing written.

// SearchItem is one hit; which fields carry payload depends on the domain.
type SearchItem struct {
	ID        string `json:"id"`
	PlanID    string `json:"plan_id,omitempty"`
	Name      string `json:"name,omitempty"`
	Topic     string `json:"topic,omitempty"`
	Title     string `json:"title,omitempty"`
	Snippet   string `json:"snippet,omitempty"`
	PlanTopic string `json:"plan_topic,omitempty"`
}

// SearchDomain is one entity family's results: the true total plus the
// first `limit` items.
type SearchDomain struct {
	Total int          `json:"total"`
	Items []SearchItem `json:"items"`
}

// SearchResults groups every domain the query touched.
type SearchResults struct {
	Query  string       `json:"q"`
	Plans  SearchDomain `json:"plans"`
	Nodes  SearchDomain `json:"nodes"`
	Notes  SearchDomain `json:"notes"`
	KbDocs SearchDomain `json:"kb_docs"`
}

// searchLimitCeil caps ?limit=; Deep-tutor serves 10 by default.
const searchLimitCeil = 50

// snippetAround centers a window on the first match so long note bodies
// show why they hit.
func snippetAround(text, q string) string {
	runes := []rune(strings.ReplaceAll(text, "\n", " "))
	if len(runes) > 120 {
		runes = runes[:120]
	}
	lower := strings.ToLower(string(runes))
	at := strings.Index(lower, strings.ToLower(q))
	if at < 0 {
		if len(runes) > 60 {
			return string(runes[:60]) + "…"
		}
		return string(runes)
	}
	start := max(at-24, 0)
	end := min(at+utf8.RuneCountInString(q)+36, len(runes))
	out := string(runes[start:end])
	if start > 0 {
		out = "…" + out
	}
	if end < len(runes) {
		out += "…"
	}
	return out
}

// SearchAll runs one substring query across plans (topic/title), knowledge
// nodes (name, tagged with their plan's topic), notes (title/body with
// a snippet), and KB documents (titles everywhere, content in the newest-50
// parsed scan with snippets).
func SearchAll(store *Store, query string, limit int) (SearchResults, error) {
	query = strings.TrimSpace(query)
	if limit <= 0 {
		limit = 10
	}
	if limit > searchLimitCeil {
		limit = searchLimitCeil
	}
	res := SearchResults{Query: query,
		Plans:  SearchDomain{Items: []SearchItem{}},
		Nodes:  SearchDomain{Items: []SearchItem{}},
		Notes:  SearchDomain{Items: []SearchItem{}},
		KbDocs: SearchDomain{Items: []SearchItem{}}}
	if query == "" {
		return res, nil
	}
	q := strings.ToLower(query)

	plans, err := store.Plans()
	if err != nil {
		return res, err
	}
	for _, p := range plans {
		if !strings.Contains(strings.ToLower(p.Topic), q) &&
			!strings.Contains(strings.ToLower(p.Title), q) {
			continue
		}
		res.Plans.Total++
		if len(res.Plans.Items) < limit {
			res.Plans.Items = append(res.Plans.Items, SearchItem{
				ID: p.ID, Topic: p.Topic, Title: p.Title,
			})
		}
	}

	// Nodes: every plan's knowledge map, each hit tagged with its plan.
	for _, p := range plans {
		plan, err := store.Plan(p.ID)
		if err != nil {
			continue
		}
		for _, n := range plan.Knowledge.Nodes {
			if !strings.Contains(strings.ToLower(n.Name), q) {
				continue
			}
			res.Nodes.Total++
			if len(res.Nodes.Items) < limit {
				res.Nodes.Items = append(res.Nodes.Items, SearchItem{
					ID: n.SID, PlanID: plan.ID, Name: n.Name, PlanTopic: p.Topic,
				})
			}
		}
	}

	notes, err := store.Notes()
	if err != nil {
		return res, err
	}
	for _, n := range notes {
		hitTitle := strings.Contains(strings.ToLower(n.Title), q)
		hitBody := strings.Contains(strings.ToLower(n.Body), q)
		if !hitTitle && !hitBody {
			continue
		}
		res.Notes.Total++
		if len(res.Notes.Items) < limit {
			item := SearchItem{ID: n.ID, Title: n.Title}
			if hitBody {
				item.Snippet = snippetAround(n.Body, query)
			}
			res.Notes.Items = append(res.Notes.Items, item)
		}
	}

	// KB documents: title hits across the whole library, then bounded
	// content hits (newest 50 parsed) with snippets — Deep-tutor's kb list
	// search, same honest no-index boundary.
	kbDocs, err := store.KbDocs()
	if err != nil {
		return res, err
	}
	titleHit := map[string]bool{}
	for i := range kbDocs {
		d := &kbDocs[i]
		if !strings.Contains(strings.ToLower(d.Title), q) {
			continue
		}
		titleHit[d.ID] = true
		res.KbDocs.Total++
		if len(res.KbDocs.Items) < limit {
			res.KbDocs.Items = append(res.KbDocs.Items, SearchItem{ID: d.ID, Title: d.Title})
		}
	}
	if room := limit - len(res.KbDocs.Items); room > 0 {
		hitDocs, snippets := store.KbContentSearch(query, room, titleHit, "")
		for i := range hitDocs {
			res.KbDocs.Total++
			if len(res.KbDocs.Items) < limit {
				res.KbDocs.Items = append(res.KbDocs.Items, SearchItem{
					ID: hitDocs[i].ID, Title: hitDocs[i].Title, Snippet: snippets[i],
				})
			}
		}
	}
	return res, nil
}
