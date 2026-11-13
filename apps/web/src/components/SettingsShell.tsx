import { useEffect, useRef, useState, type ReactNode } from 'react';

export type SettingsSection = { id: string; title: string; desc?: string; danger?: boolean; children: ReactNode };

/**
 * gen-lib's settings layout: a side nav on desktop with scroll-spy; on phones (≤900px, see _rajgruha.scss) the
 * nav becomes a sticky dropdown that always shows the section you're reading and jumps to a section when changed.
 */
export function SettingsShell({ sections }: { sections: SettingsSection[] }) {
  const ids = sections.map((s) => s.id).join('|');
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const visible = useRef(new Map<string, boolean>());
  const lockUntil = useRef(0); // after a jump, scroll-spy mustn't fight the section the person just picked

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) visible.current.set(en.target.id, en.isIntersecting);
        const first = sections.find((s) => visible.current.get(s.id));
        if (first && Date.now() > lockUntil.current) setActive(first.id);
      },
      { rootMargin: '-120px 0px -55% 0px' }
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [ids]);

  const jump = (id: string) => {
    lockUntil.current = Date.now() + 1000;
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const idx = Math.max(0, sections.findIndex((s) => s.id === active));

  return (
    <>
      {sections.length > 1 && (
        <div className="settings-bar" role="navigation" aria-label="Sections">
          <label htmlFor="section-jump">Section</label>
          <select id="section-jump" className="form-control" value={active} onChange={(e) => jump(e.target.value)}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <span className="count">{idx + 1} / {sections.length}</span>
        </div>
      )}
      <div className="settings-layout">
        <aside className="settings-nav">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={['settings-nav-link', active === s.id && 'active', s.danger && 'danger'].filter(Boolean).join(' ')} onClick={(e) => { e.preventDefault(); jump(s.id); }}>
              {s.title}
            </a>
          ))}
        </aside>
        <div className="settings-content">
          {sections.map((s) => (
            <section key={s.id} className="settings-section" id={s.id}>
              <h2 className="settings-section-title">{s.title}</h2>
              {s.desc && <p className="settings-section-desc">{s.desc}</p>}
              {s.children}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
