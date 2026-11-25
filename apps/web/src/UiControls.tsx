import { Popover } from '@base-ui/react/popover';
import { Select } from '@base-ui/react/select';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

const EMPTY_SENTINEL = '__af_empty__';

export interface SelectOption {
  value: string;
  label: string;
}

export function AfSelect({
  options,
  value,
  defaultValue,
  onChange,
  name,
  id,
  ariaLabel,
  ariaLabelledBy,
  disabled,
  className = '',
  placeholder,
}: {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? options[0]?.value ?? '');
  useEffect(() => {
    if (!controlled && defaultValue !== undefined) setInternal(defaultValue);
  }, [controlled, defaultValue]);

  const current = controlled ? value : internal;
  const encode = (raw: string) => (raw === '' ? EMPTY_SENTINEL : raw);
  const decode = (raw: string | null) => (raw === null || raw === EMPTY_SENTINEL ? '' : raw);

  const itemsMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const opt of options) map[encode(opt.value)] = opt.label;
    return map;
  }, [options]);

  const selectedLabel = itemsMap[encode(current)] ?? placeholder ?? options[0]?.label ?? '';

  function handleValueChange(next: string | null) {
    const decoded = decode(next);
    if (!controlled) setInternal(decoded);
    onChange?.(decoded);
  }

  return (
    <span className={`af-select-wrap ${className}`.trim()}>
      {name && <input type="hidden" name={name} value={current} />}
      <Select.Root
        value={encode(current)}
        onValueChange={handleValueChange}
        items={itemsMap}
        disabled={disabled}
        modal={false}
      >
        <Select.Trigger
          id={id}
          className="af-select af-select-trigger"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
        >
          <Select.Value className="af-select-value">
            {() => selectedLabel}
          </Select.Value>
          <Select.Icon className="af-select-chevron" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="af-select-positioner" sideOffset={6} align="start" alignItemWithTrigger={false}>
            <Select.Popup className="af-select-popup">
              <Select.List className="af-select-list">
                {options.map(opt => (
                  <Select.Item key={encode(opt.value)} value={encode(opt.value)} className="af-select-item">
                    <Select.ItemIndicator className="af-select-check" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m5 12 4 4L19 6" />
                      </svg>
                    </Select.ItemIndicator>
                    <Select.ItemText className="af-select-item-text">{opt.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </span>
  );
}

export function FilterPopover({
  label = 'More filters',
  activeCount = 0,
  children,
}: {
  label?: string;
  activeCount?: number;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();
  return (
    <span className="af-more-filters-wrap" ref={hostRef}>
      <Popover.Root>
        <Popover.Trigger className={`af-button af-secondary af-more-filters-trigger ${activeCount > 0 ? 'has-active' : ''}`}>
          <svg className="af-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          <span>{label}</span>
          {activeCount > 0 && <span className="af-filter-badge" aria-label={`${activeCount} active`}>{activeCount}</span>}
          <svg className="af-filter-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Popover.Trigger>
        <Popover.Portal container={hostRef} keepMounted>
          <Popover.Positioner className="af-popover-positioner" side="bottom" align="end" sideOffset={8}>
            <Popover.Popup className="af-popover-popup af-filter-popover" aria-labelledby={titleId}>
              <div className="af-popover-head">
                <Popover.Title id={titleId} className="af-popover-title">{label}</Popover.Title>
                <Popover.Close className="af-text-link af-popover-done" type="button">Done</Popover.Close>
              </div>
              <div className="af-filter-panel">
                {children}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
