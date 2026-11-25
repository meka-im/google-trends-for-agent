import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './icons.js';

export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  search?: string;
}

const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();

/** Keyboard-accessible choice control; searching never changes the saved selection. */
export function ChoicePicker({ label, hint, icon, placeholder, emptyText, options, value, disabled,
  compact = false, hideLabel = false, searchable = true, onChange }: {
  label: string; hint?: string; icon?: string; placeholder: string; emptyText: string;
  compact?: boolean; hideLabel?: boolean; searchable?: boolean;
  options: readonly ChoiceOption[]; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ up: false, height: 280 });
  const selected = options.find(option => option.value === value);
  const filtered = useMemo(() => {
    const needle = fold(query);
    return needle ? options.filter(option => fold(`${option.label} ${option.value} ${option.search ?? ''} ${option.description ?? ''}`).includes(needle)) : options;
  }, [options, query]);
  const activeIndex = Math.max(0, Math.min(active, filtered.length - 1));
  const visible = open && !disabled;

  const close = () => { setOpen(false); setQuery(''); };
  const expand = () => {
    if (disabled || open) return;
    const bounds = root.current?.getBoundingClientRect();
    if (bounds) {
      const below = window.innerHeight - bounds.bottom;
      const up = below < 240 && bounds.top > below;
      setPlacement({ up, height: Math.max(104, Math.min(280, (up ? bounds.top : below) - 24)) });
    }
    setQuery('');
    setActive(Math.max(0, options.findIndex(option => option.value === value)));
    setOpen(true);
  };
  const choose = (option: ChoiceOption) => { onChange(option.value); close(); };

  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) { setOpen(false); setQuery(''); }
    };
    const resize = () => { setOpen(false); setQuery(''); };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', resize);
    };
  }, [visible]);

  useEffect(() => {
    if (visible) list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [visible, activeIndex, filtered]);

  useEffect(() => { if (disabled) { setOpen(false); setQuery(''); } }, [disabled]);

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (searchable && (event.nativeEvent.isComposing || event.key === 'Process')) { if (!visible) expand(); return; }
    if (searchable && !visible && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); expand(); setQuery(event.key); setActive(0); return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visible) expand();
      else if (filtered.length) setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!visible) expand();
      else if (filtered[activeIndex]) choose(filtered[activeIndex]!);
    } else if (event.key === 'Escape' && visible) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === 'Tab') close();
  };

  return <div className={`gtfa-choice-field${compact ? ' compact' : ''}`}>
    <label className={hideLabel ? 'gtfa-sr-only' : undefined} htmlFor={`${id}-input`}>{label}</label>
    <div ref={root} className={`gtfa-choice${visible ? ' open' : ''}${disabled ? ' disabled' : ''}`}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
      <div className="gtfa-choice-control">
        {icon ? <span className="gtfa-choice-icon"><Icon name={icon} size={14} /></span> : null}
        <input ref={input} id={`${id}-input`} role="combobox" type="text" autoComplete="off" spellCheck={false}
          aria-expanded={visible} aria-autocomplete={searchable ? 'list' : 'none'} aria-haspopup="listbox"
          aria-controls={visible ? `${id}-list` : undefined} aria-describedby={hint ? `${id}-hint` : undefined}
          aria-activedescendant={visible && filtered.length ? `${id}-option-${activeIndex}` : undefined}
          value={visible && searchable ? query : selected?.label ?? value} placeholder={visible && searchable ? placeholder : selected?.label ?? value}
          disabled={disabled} readOnly={!visible || !searchable} onFocus={expand} onClick={expand} onKeyDown={keyDown}
          onChange={event => { if (!visible) expand(); setQuery(event.target.value); setActive(0); }} />
        <button type="button" className="gtfa-choice-toggle" aria-label={label} tabIndex={-1} disabled={disabled}
          onMouseDown={event => event.preventDefault()} onClick={() => { if (visible) close(); else expand(); input.current?.focus(); }}>
          <Icon name="chevron" size={15} />
        </button>
      </div>
      {visible ? <div className={`gtfa-choice-popover${placement.up ? ' above' : ''}`}>
        <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} style={{ maxHeight: placement.height }}>
          {filtered.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option"
            aria-selected={option.value === value} data-active={index === activeIndex} className="gtfa-choice-option"
            onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(option)}>
            <span className="gtfa-choice-option-copy"><span>{option.label}{option.badge ? <small>{option.badge}</small> : null}</span>
              {option.description ? <span>{option.description}</span> : null}</span>
            {option.value === value ? <span className="gtfa-choice-check"><Icon name="check" size={15} /></span> : null}
          </div>)}
          {!filtered.length ? <p className="gtfa-choice-empty" role="status">{emptyText}</p> : null}
        </div>
      </div> : null}
    </div>
    {hint ? <p className="gtfa-choice-hint" id={`${id}-hint`}>{hint}</p> : null}
  </div>;
}
