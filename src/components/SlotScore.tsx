import { useEffect, useRef, useState, type FC, type CSSProperties } from 'react';

interface SlotScoreProps {
  value: number;
  decimals?: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * Casino-style slot machine score display.
 * When the value changes, digits roll up (green) or down (red).
 */
const SlotScore: FC<SlotScoreProps> = ({ value, decimals = 1, style, className }) => {
  const prevValue = useRef(value);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (prevValue.current !== value) {
      setDirection(value > prevValue.current ? 'up' : 'down');
      setAnimKey((k) => k + 1);
      prevValue.current = value;
    }
  }, [value]);

  const formatted = value.toFixed(decimals);
  const digits = formatted.split('');

  return (
    <span className={className} style={{ ...style, display: 'inline-flex', position: 'relative' }}>
      {digits.map((char, i) => {
        if (char === '.') {
          return (
            <span key={`dot-${i}`} style={{ lineHeight: 1 }}>
              .
            </span>
          );
        }

        return (
          <SlotDigit
            key={`d-${i}`}
            digit={char}
            direction={direction}
            animKey={animKey}
            delay={i * 30}
            fontSize={style?.fontSize}
          />
        );
      })}

      {/* Flash overlay on change */}
      {direction && (
        <span
          key={`flash-${animKey}`}
          className="slot-flash"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              direction === 'up'
                ? 'linear-gradient(180deg, #00ff8840, transparent)'
                : 'linear-gradient(0deg, #ff222240, transparent)',
            pointerEvents: 'none',
          }}
        />
      )}
    </span>
  );
};

interface SlotDigitProps {
  digit: string;
  direction: 'up' | 'down' | null;
  animKey: number;
  delay: number;
  fontSize?: string | number;
}

const SlotDigit: FC<SlotDigitProps> = ({ digit, direction, animKey, delay, fontSize }) => {
  return (
    <span
      className="slot-digit-wrapper"
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        position: 'relative',
        height: '1em',
      }}
    >
      <span
        key={`${animKey}-${digit}`}
        className={direction ? `slot-roll-${direction}` : undefined}
        style={{
          display: 'inline-block',
          animationDelay: `${delay}ms`,
          lineHeight: 1,
          fontSize: fontSize,
        }}
      >
        {digit}
      </span>
    </span>
  );
};

export default SlotScore;
