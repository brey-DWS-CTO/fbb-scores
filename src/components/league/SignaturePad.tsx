import { useEffect, useRef, useState } from 'react';

/**
 * A box to sign in with a finger or a mouse.
 *
 * Pointer events cover both, and touch-action: none keeps a finger from
 * scrolling the page while it signs. The drawing is kept at a fixed 600 by
 * 200 so it prints at the same shape on everyone's copy, and it leaves as a
 * PNG data URL with a clear background.
 */
const WIDTH = 600;
const HEIGHT = 200;

export default function SignaturePad({
  onChange,
}: {
  /** The PNG data URL after each stroke, or null once cleared. */
  onChange: (drawing: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const context = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    // Thick enough to survive shrinking to a 30-point line on the PDF.
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    return ctx;
  };

  /** Where the pointer is, in drawing pixels, whatever size the box shows at. */
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * WIDTH,
      y: ((event.clientY - box.top) / box.height) * HEIGHT,
    };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A tap leaves a dot, so a short signature still counts.
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setEmpty(false);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = context();
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  };

  useEffect(() => clear, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sign-pad">
      <canvas
        ref={canvasRef}
        className="sign-pad-canvas"
        width={WIDTH}
        height={HEIGHT}
        aria-label="Sign here with a finger or the mouse"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <div className="sign-pad-foot">
        <span className="sign-pad-hint">{empty ? 'Sign in the box' : 'Looks good? Sign below.'}</span>
        <button type="button" className="rules-tool tap-btn" onClick={clear} disabled={empty}>
          CLEAR
        </button>
      </div>
    </div>
  );
}
