import type { SVGProps } from 'react';

export type V2IconName = 'home' | 'store' | 'benefit' | 'news' | 'me' | 'search' | 'heart' | 'check' | 'arrow';

type V2IconProps = SVGProps<SVGSVGElement> & { name: V2IconName };

export function V2Icon({ name, className = '', ...props }: V2IconProps) {
  return (
    <svg {...props} className={`v2-icon ${className}`.trim()} viewBox="0 0 24 24" fill="none" aria-hidden={props['aria-label'] ? undefined : true}>
      {name === 'home' && <path d="M3.5 10.5 12 3l8.5 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-5v-6H10v6H5a1.5 1.5 0 0 1-1.5-1.5z" />}
      {name === 'store' && <path d="M4 9h16l-1.2-5.5H5.2zM5 9v11h14V9M8.5 13.5h7" />}
      {name === 'benefit' && <path d="M4 6.5h16v11H4zM8 6.5V4h8v2.5M8.5 12h7M12 9v6" />}
      {name === 'news' && <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />}
      {name === 'me' && <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-4.2 3.1-6.2 7-6.2s6.2 2 7 6.2" /></>}
      {name === 'search' && <><circle cx="10.5" cy="10.5" r="5.8" /><path d="m15 15 5 5" /></>}
      {name === 'heart' && <path d="M12 20S4.5 15.7 4.5 9.8A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 7.5 2.9C19.5 15.7 12 20 12 20Z" />}
      {name === 'check' && <path className="v2-icon-check" d="m5 12.5 4.2 4.1L19 7" />}
      {name === 'arrow' && <path d="M5 12h14m-5-5 5 5-5 5" />}
    </svg>
  );
}
