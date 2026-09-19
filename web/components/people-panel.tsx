'use client';
/* oxlint-disable next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import './people-panel.css';

type Frame = { id: string; captured_at: number; media_url: string };
type Person = {
  id: string;
  name: string;
  version: number;
  evidence: {
    id: string;
    media_id: string;
    media_url: string;
    captured_at: number;
  }[];
};
type Face = {
  key: string;
  box: [number, number, number, number];
  match: {
    status: 'unknown' | 'ambiguous' | 'possible_match';
    person_id?: string;
    name?: string;
  };
};
type Inspection = { media_id: string; faces: Face[] };
type Coverage = { retained_frames: number; indexed_frames: number };
type PeopleResponse = { people: Person[]; coverage: Coverage };
type Sightings = {
  possible_sightings: {
    media_id: string;
    captured_at: number;
    media_url: string;
  }[];
  coverage: Coverage;
};

export function PeoplePanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selected, setSelected] = useState<Frame | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [faceKey, setFaceKey] = useState('');
  const [name, setName] = useState('');
  const [personId, setPersonId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [sightings, setSightings] = useState<Record<string, Sightings>>({});
  const generation = useRef(0);

  async function refresh() {
    const [persons, recent] = await Promise.all([
      api<PeopleResponse>('/people'),
      api<Frame[]>('/people/frames'),
    ]);
    setPeople(persons.people);
    setCoverage(persons.coverage);
    setFrames(recent);
  }
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<PeopleResponse>('/people'),
      api<Frame[]>('/people/frames'),
    ])
      .then(([persons, recent]) => {
        if (alive) {
          setPeople(persons.people);
          setCoverage(persons.coverage);
          setFrames(recent);
        }
      })
      .catch((problem) => {
        if (alive) setError(String(problem).replace(/^Error: /, ''));
      });
    return () => {
      alive = false;
      generation.current += 1;
    };
  }, []);

  async function inspect(frame: Frame) {
    const current = ++generation.current;
    setSelected(frame);
    setInspection(null);
    setFaceKey('');
    setName('');
    setPersonId('');
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await api<Inspection>(
        '/people/frames/' + frame.id + '/faces',
      );
      if (current !== generation.current) return;
      setInspection(result);
      if (result.faces.length === 1) setFaceKey(result.faces[0].key);
    } catch (problem) {
      if (current === generation.current)
        setError(String(problem).replace(/^Error: /, ''));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  async function change(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(message);
      setEditing(null);
      setSightings({});
      setInspection(null);
      setFaceKey('');
    } catch (problem) {
      setError(String(problem).replace(/^Error: /, ''));
    } finally {
      setBusy(false);
    }
  }

  const face = inspection?.faces.find((item) => item.key === faceKey);
  return (
    <section className="people-panel" aria-label="Faces and names">
      <div className="people-heading">
        <h2>Faces &amp; names</h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh().catch((e) => setError(String(e)))}
        >
          Refresh
        </button>
      </div>
      <p>
        Choose a saved moment and tell me who is pictured. You confirm every
        name; a similar face is only a possible match.
      </p>
      {error && (
        <p className="people-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="people-notice">{notice}</output>}
      {frames.length === 0 ? (
        <p>No saved pictures yet. Record a moment with your phone first.</p>
      ) : (
        <div className="people-frames" aria-label="Choose a saved moment">
          {frames.map((frame) => (
            <button
              key={frame.id}
              type="button"
              disabled={busy}
              aria-pressed={selected?.id === frame.id}
              onClick={() => void inspect(frame)}
            >
              <img src={frame.media_url} alt="Saved moment" loading="lazy" />
              <span>
                {new Date(frame.captured_at * 1000).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="people-selection">
          <div className="people-picture">
            <img
              src={selected.media_url}
              alt="Selected original moment; choose a detected face"
            />
            {inspection?.faces.map((item, index) => (
              <button
                key={item.key}
                className="people-face-box"
                type="button"
                disabled={busy}
                aria-label={'Choose face ' + (index + 1)}
                aria-pressed={faceKey === item.key}
                style={{
                  left: item.box[0] * 100 + '%',
                  top: item.box[1] * 100 + '%',
                  width: (item.box[2] - item.box[0]) * 100 + '%',
                  height: (item.box[3] - item.box[1]) * 100 + '%',
                }}
                onClick={() => {
                  setFaceKey(item.key);
                  setPersonId('');
                  setName('');
                }}
              >
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
          {busy && !inspection && (
            <output>Looking for clear faces on the ASUS…</output>
          )}
          {inspection?.faces.length === 0 && (
            <p>
              No clear face was detected. Try another picture with a larger,
              front-facing face.
            </p>
          )}
          {inspection && inspection.faces.length > 1 && !face && (
            <p>Tap the box around the person you want to remember.</p>
          )}
          {face && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const requestId = crypto.randomUUID();
                void change(
                  () =>
                    api('/people/confirm', {
                      method: 'POST',
                      body: JSON.stringify({
                        request_id: requestId,
                        media_id: selected.id,
                        face_key: face.key,
                        name: name.trim(),
                        person_id: personId || null,
                        confirmed: true,
                      }),
                    }),
                  'Name saved with this original picture.',
                );
              }}
            >
              {face.match.status === 'possible_match' && (
                <p className="people-possible">
                  Possible match: <strong>{face.match.name}</strong>. Check the
                  picture before choosing a name.
                </p>
              )}
              {face.match.status === 'ambiguous' && (
                <p>
                  More than one saved person looks similar. Please choose the
                  person yourself.
                </p>
              )}
              {face.match.status === 'unknown' && (
                <p>I don’t have a clear saved match for this face.</p>
              )}
              <label>
                Who is this?
                <select
                  value={personId}
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPersonId(value);
                    setName(
                      people.find((person) => person.id === value)?.name || '',
                    );
                  }}
                >
                  <option value="">Someone new</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name
                <input
                  value={name}
                  maxLength={120}
                  required
                  disabled={busy || !!personId}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy || !name.trim()}>
                Confirm this person’s name
              </button>
            </form>
          )}
        </div>
      )}
      {people.length > 0 && <h3>People you’ve confirmed</h3>}
      {people.length > 0 && coverage && (
        <p>
          Faces checked in {coverage.indexed_frames} of{' '}
          {coverage.retained_frames} saved pictures. New pictures are checked
          after you confirm a person.
        </p>
      )}
      <div className="people-saved">
        {people.map((person) => (
          <article key={person.id}>
            {editing === person.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void change(
                    () =>
                      api('/people/' + person.id, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          name: editName.trim(),
                          version: person.version,
                        }),
                      }),
                    'Name corrected.',
                  );
                }}
              >
                <label>
                  Correct name
                  <input
                    value={editName}
                    maxLength={120}
                    required
                    onChange={(event) => setEditName(event.target.value)}
                  />
                </label>
                <button disabled={busy || !editName.trim()} type="submit">
                  Save correction
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <div className="people-person-heading">
                <strong>{person.name}</strong>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(person.id);
                    setEditName(person.name);
                  }}
                >
                  Correct name
                </button>
              </div>
            )}
            <p>
              {person.evidence.length} confirmed{' '}
              {person.evidence.length === 1 ? 'picture' : 'pictures'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void api<Sightings>('/people/' + person.id + '/sightings')
                  .then((result) => {
                    setSightings((current) => ({
                      ...current,
                      [person.id]: result,
                    }));
                    setCoverage(result.coverage);
                  })
                  .catch((problem) =>
                    setError(String(problem).replace(/^Error: /, '')),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Find possible appearances
            </button>
            {sightings[person.id] && (
              <div className="people-sighting-results">
                <p>
                  Similar faces to review — these are not confirmed sightings.
                </p>
                {sightings[person.id].possible_sightings.length === 0 && (
                  <p>
                    No clear possible matches in the pictures checked so far.
                  </p>
                )}
                <div className="people-frames">
                  {sightings[person.id].possible_sightings.map((sighting) => (
                    <button
                      type="button"
                      disabled={busy}
                      key={sighting.media_id}
                      onClick={() =>
                        void inspect({ ...sighting, id: sighting.media_id })
                      }
                    >
                      <img
                        src={sighting.media_url}
                        alt="Possible appearance; review the original"
                        loading="lazy"
                      />
                      <span>
                        {new Date(
                          sighting.captured_at * 1000,
                        ).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="people-evidence">
              {person.evidence.map((evidence) => (
                <div key={evidence.id}>
                  <a href={evidence.media_url} target="_blank" rel="noreferrer">
                    <img
                      src={evidence.media_url}
                      alt={'Original picture you labeled ' + person.name}
                      loading="lazy"
                    />
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void change(
                        () =>
                          api('/people/evidence/' + evidence.id, {
                            method: 'DELETE',
                          }),
                        'Name link removed. The original picture is still saved.',
                      )
                    }
                  >
                    Remove this link
                  </button>
                </div>
              ))}
            </div>
            <button
              className="people-forget"
              type="button"
              disabled={busy}
              onClick={() =>
                void change(
                  () => api('/people/' + person.id, { method: 'DELETE' }),
                  'This person is no longer used for face matching. Original pictures remain saved.',
                )
              }
            >
              Forget this person
            </button>
          </article>
        ))}
      </div>
      <p className="people-footnote">
        Face matching is experimental. It can miss people or confuse similar
        faces. Names come from your confirmations, never from a contacts list.
      </p>
    </section>
  );
}
