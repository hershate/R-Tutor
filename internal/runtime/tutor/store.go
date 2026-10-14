package tutor

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"reasonix/internal/base/fileutil"
)

// ErrNotFound is the identity for a missing tutor resource; HTTP layers map
// it to their not-found refusal code without matching text.
var ErrNotFound = errors.New("tutor: not found")

// Store persists the tutor domain as JSON files under one root, one
// aggregate per file, every write atomic. Store is stateless: methods only
// compute paths and touch files, so disjoint sessions need no locking.
type Store struct {
	root string
}

// GenSession is one plan-generation workspace: the uploaded materials, the
// orchestrator state machine, and the plan lineage it produced.
type GenSession struct {
	ID               string    `json:"id"`
	Title            string    `json:"title"`
	CreatedAt        time.Time `json:"created_at"`
	Status           Status    `json:"status"`
	CurrentTool      string    `json:"current_tool,omitempty"`
	StepIndex        int       `json:"step_index,omitempty"`
	TotalSteps       int       `json:"total_steps,omitempty"`
	LastError        string    `json:"last_error,omitempty"`
	RawText          string    `json:"raw_text,omitempty"`
	PlanID           string    `json:"plan_id,omitempty"`
	PlanVersion      int       `json:"plan_version,omitempty"`
	ClarifyQuestions []string  `json:"clarify_questions,omitempty"`
	Cost             float64   `json:"cost,omitempty"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// PlanSummary is the list-view projection of a plan lineage.
type PlanSummary struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	Title     string    `json:"title"`
	Topic     string    `json:"topic"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type planIndex struct {
	Plans []PlanSummary `json:"plans"`
}

func OpenStore(root string) (*Store, error) {
	if root == "" {
		return nil, errors.New("tutor: store root is empty")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

func (s *Store) Root() string { return s.root }

func (s *Store) sessionDir(id string) string { return filepath.Join(s.root, "sessions", id) }
func (s *Store) planDir(id string) string    { return filepath.Join(s.root, "plans", id) }
func (s *Store) notesDir() string            { return filepath.Join(s.root, "notes") }

func (s *Store) writeJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return fileutil.AtomicOverwriteFile(path, data, 0o644)
}

func (s *Store) readJSON(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("tutor: decode %s: %w", filepath.Base(path), err)
	}
	return nil
}

func newID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic("tutor: crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)
}

// CreateSession mints a generation session.
func (s *Store) CreateSession(title string) (*GenSession, error) {
	now := time.Now()
	sess := &GenSession{
		ID:        newID(),
		Title:     title,
		CreatedAt: now,
		UpdatedAt: now,
		Status:    StatusIdle,
	}
	if err := s.writeJSON(filepath.Join(s.sessionDir(sess.ID), "session.json"), sess); err != nil {
		return nil, err
	}
	return sess, nil
}

func (s *Store) Session(id string) (*GenSession, error) {
	var sess GenSession
	if err := s.readJSON(filepath.Join(s.sessionDir(id), "session.json"), &sess); err != nil {
		return nil, err
	}
	return &sess, nil
}

func (s *Store) SaveSession(sess *GenSession) error {
	sess.UpdatedAt = time.Now()
	return s.writeJSON(filepath.Join(s.sessionDir(sess.ID), "session.json"), sess)
}

// DeleteSession removes the session workspace and cascades to its plan
// lineages, mirroring Deep-tutor's session-delete cascade.
func (s *Store) DeleteSession(id string) error {
	sess, err := s.Session(id)
	if err != nil {
		return err
	}
	if sess.PlanID != "" {
		if rmErr := os.RemoveAll(s.planDir(sess.PlanID)); rmErr != nil {
			return rmErr
		}
		if err := s.deleteSharesForPlan(sess.PlanID); err != nil {
			return err
		}
		if err := s.reindexPlans(); err != nil {
			return err
		}
	}
	return os.RemoveAll(s.sessionDir(id))
}

// Sessions lists generation sessions, newest first.
func (s *Store) Sessions() ([]GenSession, error) {
	entries, err := os.ReadDir(filepath.Join(s.root, "sessions"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []GenSession
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sess, err := s.Session(e.Name())
		if err != nil {
			continue
		}
		out = append(out, *sess)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

// SaveMaterial records one material row; originals and parsed text live in
// sibling directories keyed by the same id.
func (s *Store) SaveMaterial(m *Material) error {
	return s.writeJSON(filepath.Join(s.sessionDir(m.SessionID), "materials", m.ID+".json"), m)
}

func (s *Store) Materials(sessionID string) ([]Material, error) {
	entries, err := os.ReadDir(filepath.Join(s.sessionDir(sessionID), "materials"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []Material
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		var m Material
		if err := s.readJSON(filepath.Join(s.sessionDir(sessionID), "materials", e.Name()), &m); err == nil {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (s *Store) DeleteMaterial(sessionID, materialID string) error {
	base := filepath.Join(s.sessionDir(sessionID))
	if err := os.Remove(filepath.Join(base, "materials", materialID+".json")); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	originals, _ := filepath.Glob(filepath.Join(base, "originals", materialID+".*"))
	for _, p := range originals {
		_ = os.Remove(p)
	}
	_ = os.Remove(filepath.Join(base, "parsed", materialID+".txt"))
	return nil
}

var safeExt = regexp.MustCompile(`^[A-Za-z0-9]{1,8}$`)

// WriteMaterialOriginal stores the raw upload; ext is sanitized so a crafted
// filename cannot escape the originals directory.
func (s *Store) WriteMaterialOriginal(sessionID, materialID, ext string, data []byte) (string, error) {
	ext = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(ext)), ".")
	if !safeExt.MatchString(ext) {
		ext = "bin"
	}
	path := filepath.Join(s.sessionDir(sessionID), "originals", materialID+"."+ext)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if err := fileutil.AtomicOverwriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func (s *Store) WriteMaterialParsed(sessionID, materialID, text string) error {
	return s.writeRaw(filepath.Join(s.sessionDir(sessionID), "parsed", materialID+".txt"), []byte(text))
}

func (s *Store) ReadMaterialParsed(sessionID, materialID string) (string, error) {
	data, err := os.ReadFile(filepath.Join(s.sessionDir(sessionID), "parsed", materialID+".txt"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", ErrNotFound
		}
		return "", err
	}
	return string(data), nil
}

// materialOriginalPath resolves an original's path, falling back to the .bin
// name WriteMaterialOriginal sanitizes an unusual extension to.
func (s *Store) materialOriginalPath(sessionID, materialID, source string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(source)), ".")
	if ext == "" || !safeExt.MatchString(ext) {
		ext = "bin"
	}
	direct := filepath.Join(s.sessionDir(sessionID), "originals", materialID+"."+ext)
	if _, err := os.Stat(direct); err == nil {
		return direct
	}
	return filepath.Join(s.sessionDir(sessionID), "originals", materialID+".bin")
}

// ReadMaterialOriginal returns a staged text material's content.
func (s *Store) ReadMaterialOriginal(sessionID, materialID string) (string, error) {
	data, err := os.ReadFile(filepath.Join(s.sessionDir(sessionID), "originals", materialID+".txt"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", ErrNotFound
		}
		return "", err
	}
	return string(data), nil
}

// ReadMaterialOriginalBytes returns an uploaded file's original bytes.
func (s *Store) ReadMaterialOriginalBytes(sessionID, materialID, source string) ([]byte, error) {
	data, err := os.ReadFile(s.materialOriginalPath(sessionID, materialID, source))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return data, nil
}

func (s *Store) writeRaw(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return fileutil.AtomicOverwriteFile(path, data, 0o644)
}

// SavePlan persists a plan version: latest under the plan dir, every version
// kept for comparison, and the list index refreshed.
// StudyUnit is one persisted self-study unit of a plan.
type StudyUnit struct {
	ID            string   `json:"id"`
	Order         int      `json:"order"`
	Title         string   `json:"title"`
	StageIndex    int      `json:"stage_index"`
	NodeSIDs      []string `json:"node_sids,omitempty"`
	EstimatedTime string   `json:"estimated_time,omitempty"`
	Objectives    []string `json:"objectives,omitempty"`
	Prerequisites []string `json:"prerequisites,omitempty"`
	ContentMD     string   `json:"content_md"`
	Degraded      bool     `json:"degraded,omitempty"`
}

func (s *Store) materialsPath(planID string) string {
	return filepath.Join(s.planDir(planID), "materials.json")
}

// SaveStudyUnits replaces the plan's whole unit list in one write.
func (s *Store) SaveStudyUnits(planID string, units []StudyUnit) error {
	return s.writeJSON(s.materialsPath(planID), units)
}

// StudyUnits reads the plan's units; an absent file is an empty list.
func (s *Store) StudyUnits(planID string) ([]StudyUnit, error) {
	var units []StudyUnit
	if err := s.readJSON(s.materialsPath(planID), &units); err != nil {
		return nil, nil
	}
	return units, nil
}

// WriteMaterialsIndex stores the rendered roadmap beside the units.
func (s *Store) WriteMaterialsIndex(planID, md string) error {
	return s.writeRaw(filepath.Join(s.planDir(planID), "materials-index.md"), []byte(md))
}

func (s *Store) ReadMaterialsIndex(planID string) (string, error) {
	data, err := os.ReadFile(filepath.Join(s.planDir(planID), "materials-index.md"))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (s *Store) SavePlan(p *Plan) error {
	p.UpdatedAt = time.Now()
	if err := s.writeJSON(filepath.Join(s.planDir(p.ID), "plan.json"), p); err != nil {
		return err
	}
	if err := s.writeJSON(filepath.Join(s.planDir(p.ID), "versions", fmt.Sprintf("v%03d.json", p.Version)), p); err != nil {
		return err
	}
	return s.reindexPlans()
}

func (s *Store) Plan(id string) (*Plan, error) {
	var p Plan
	if err := s.readJSON(filepath.Join(s.planDir(id), "plan.json"), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) PlanVersion(id string, version int) (*Plan, error) {
	var p Plan
	name := fmt.Sprintf("v%03d.json", version)
	if err := s.readJSON(filepath.Join(s.planDir(id), "versions", name), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) Plans() ([]PlanSummary, error) {
	var idx planIndex
	if err := s.readJSON(filepath.Join(s.root, "plans", "index.json"), &idx); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	sort.Slice(idx.Plans, func(i, j int) bool { return idx.Plans[i].UpdatedAt.After(idx.Plans[j].UpdatedAt) })
	return idx.Plans, nil
}

func (s *Store) reindexPlans() error {
	entries, err := os.ReadDir(filepath.Join(s.root, "plans"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	idx := planIndex{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p, err := s.Plan(e.Name())
		if err != nil {
			continue
		}
		idx.Plans = append(idx.Plans, PlanSummary{
			ID: p.ID, SessionID: p.SessionID, Title: p.Title, Topic: p.Topic,
			Version: p.Version, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		})
	}
	return s.writeJSON(filepath.Join(s.root, "plans", "index.json"), &idx)
}

func (s *Store) quizzesPath(planID string) string {
	return filepath.Join(s.planDir(planID), "quizzes.json")
}

func (s *Store) Quizzes(planID string) ([]Quiz, error) {
	var quizzes []Quiz
	if err := s.readJSON(s.quizzesPath(planID), &quizzes); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return quizzes, nil
}

func (s *Store) SaveQuizzes(planID string, quizzes []Quiz) error {
	return s.writeJSON(s.quizzesPath(planID), quizzes)
}

func (s *Store) AppendAttempt(planID string, attempt QuizAttempt) error {
	attempts, err := s.Attempts(planID)
	if err != nil {
		return err
	}
	attempts = append(attempts, attempt)
	return s.writeJSON(filepath.Join(s.planDir(planID), "attempts.json"), attempts)
}

// ClearAttempts drops the attempt history — a regenerated quiz set is a new
// instrument, so its predecessors' answers stop counting.
func (s *Store) ClearAttempts(planID string) error {
	return s.writeJSON(filepath.Join(s.planDir(planID), "attempts.json"), []QuizAttempt{})
}

func (s *Store) Attempts(planID string) ([]QuizAttempt, error) {
	var attempts []QuizAttempt
	if err := s.readJSON(filepath.Join(s.planDir(planID), "attempts.json"), &attempts); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return attempts, nil
}

func (s *Store) ProgressList(planID string) ([]Progress, error) {
	var list []Progress
	if err := s.readJSON(filepath.Join(s.planDir(planID), "progress.json"), &list); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return list, nil
}

func (s *Store) SaveProgress(planID string, list []Progress) error {
	return s.writeJSON(filepath.Join(s.planDir(planID), "progress.json"), list)
}

func (s *Store) Logs(planID string) ([]LearningLog, error) {
	var logs []LearningLog
	if err := s.readJSON(filepath.Join(s.planDir(planID), "logs.json"), &logs); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return logs, nil
}

func (s *Store) AddLog(log *LearningLog) error {
	if log.ID == "" {
		log.ID = newID()
	}
	logs, err := s.Logs(log.PlanID)
	if err != nil {
		return err
	}
	log.CreatedAt = time.Now()
	logs = append(logs, *log)
	return s.writeJSON(filepath.Join(s.planDir(log.PlanID), "logs.json"), logs)
}

func (s *Store) DeleteLog(planID, logID string) error {
	logs, err := s.Logs(planID)
	if err != nil {
		return err
	}
	kept := logs[:0]
	found := false
	for _, l := range logs {
		if l.ID == logID {
			found = true
			continue
		}
		kept = append(kept, l)
	}
	if !found {
		return ErrNotFound
	}
	return s.writeJSON(filepath.Join(s.planDir(planID), "logs.json"), kept)
}

func (s *Store) Notes() ([]Note, error) {
	entries, err := os.ReadDir(s.notesDir())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []Note
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		var n Note
		if err := s.readJSON(filepath.Join(s.notesDir(), e.Name()), &n); err == nil {
			out = append(out, n)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (s *Store) Note(id string) (*Note, error) {
	var n Note
	if err := s.readJSON(filepath.Join(s.notesDir(), id+".json"), &n); err != nil {
		return nil, err
	}
	return &n, nil
}

func (s *Store) SaveNote(n *Note) error {
	now := time.Now()
	if n.ID == "" {
		n.ID = newID()
		n.CreatedAt = now
	}
	n.UpdatedAt = now
	return s.writeJSON(filepath.Join(s.notesDir(), n.ID+".json"), n)
}

func (s *Store) DeleteNote(id string) error {
	if err := os.Remove(filepath.Join(s.notesDir(), id+".json")); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	return nil
}
