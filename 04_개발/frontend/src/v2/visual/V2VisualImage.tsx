import { useEffect, useState, type ImgHTMLAttributes } from 'react';

type V2VisualImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string;
  fallbackSrc?: string;
  fallbackLabel?: string;
};

export function V2VisualImage({ src, fallbackSrc, fallbackLabel = '이미지', alt = '', onError, ...props }: V2VisualImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setResolvedSrc(src);
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <span className="v2-photo-fallback" role={alt ? 'img' : undefined} aria-label={alt || undefined}>
        <span aria-hidden="true">{fallbackLabel}</span>
      </span>
    );
  }

  return (
    <img
      {...props}
      src={resolvedSrc}
      alt={alt}
      onError={(event) => {
        onError?.(event);
        if (fallbackSrc && resolvedSrc !== fallbackSrc) {
          setResolvedSrc(fallbackSrc);
          return;
        }
        setFailed(true);
      }}
    />
  );
}
