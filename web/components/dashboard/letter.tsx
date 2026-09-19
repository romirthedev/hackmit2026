'use client';
/* oxlint-disable next/no-img-element -- photos are local blob URLs or served by the local server */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

// A small letter carries a scanned photo from the phone up into a cloud, and
// on the home dashboard the same letter drops out of the cloud and opens
// into the Moments card. While the letter travels the page behind it goes
// soft, so the eye follows the letter.

export const ENV_W = 128;
export const ENV_H = 86;
const PHOTO_W = 100;
const PHOTO_H = 68;
const REST_Y = 31; // photo's resting y inside the envelope
const CLIP_UP = 320; // the clip only trims the photo below the envelope
const soft = { type: 'spring' as const, stiffness: 170, damping: 22 };
const gentle = { type: 'spring' as const, stiffness: 120, damping: 16 };

function Backdrop({ show }: { show: boolean }) {
  return (
    <motion.div
      className="letter-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: show ? 1 : 0 }}
      transition={{ duration: 0.5 }}
    />
  );
}

export function CloudPuff({
  x,
  y,
  show,
  bump = 0,
}: {
  x: number;
  y: number;
  show: boolean;
  bump?: number;
}) {
  return (
    <motion.svg
      className="cloud"
      width={150}
      height={90}
      viewBox="0 0 150 90"
      style={{ left: x - 75, top: y - 45 }}
      initial={{ opacity: 0, scale: 0.7, y: -16 }}
      animate={
        show
          ? { opacity: 1, scale: 1, y: 0 }
          : { opacity: 0, scale: 0.8, y: -20 }
      }
      transition={gentle}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cloud-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e6eef8" />
        </linearGradient>
      </defs>
      <motion.g
        key={bump}
        animate={bump ? { scale: [1, 1.1, 0.97, 1] } : { scale: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        style={{ originX: '75px', originY: '55px' }}
      >
        <path
          d="M30 76 C14 76 10 56 26 50 C24 30 48 22 60 36 C66 12 104 12 108 38 C128 34 140 56 126 68 C132 80 118 84 110 78 Z"
          fill="url(#cloud-fill)"
          stroke="rgba(70,100,140,0.14)"
          strokeWidth="1.2"
        />
        <ellipse cx="72" cy="78" rx="46" ry="5" fill="rgba(70,100,140,0.06)" />
      </motion.g>
    </motion.svg>
  );
}

// The envelope. `inner` is the photo copy that lives inside the body and is
// clipped by it; it slides in from above (phone) or out of the top (desktop).
function Envelope({
  open,
  photo,
  innerY,
  innerVisible,
}: {
  open: boolean;
  photo: string;
  innerY: number;
  innerVisible: boolean;
}) {
  return (
    <div className="env" style={{ width: ENV_W, height: ENV_H }}>
      <span className="env-body" />
      <div
        className="env-clip"
        style={{ top: -CLIP_UP, height: CLIP_UP + ENV_H }}
      >
        <motion.img
          className="env-inner"
          src={photo}
          alt=""
          style={{
            width: PHOTO_W,
            height: PHOTO_H,
            left: (ENV_W - PHOTO_W) / 2,
            top: CLIP_UP,
            opacity: innerVisible ? 1 : 0,
          }}
          initial={false}
          animate={{ y: innerY }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        />
      </div>
      <span className="env-pocket" />
      <motion.span
        className="env-flap"
        initial={false}
        animate={{ rotateX: open ? 180 : 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        <i className="env-seal" />
      </motion.span>
    </div>
  );
}

export type Send = { id: number; photo: string; from: DOMRect };

// Phone. Steps:
// 1 photo shrinks and hovers over the open envelope
// 2 photo slides down into it
// 3 flap closes
// 4 page goes soft; letter lifts up to the cloud
// 5 cloud takes it
export function SendLetter({
  send,
  onDone,
}: {
  send: Send | null;
  onDone: (id: number) => void;
}) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [bump, setBump] = useState(0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (!send) return;
    // oxlint-disable-next-line react/react-compiler -- one-off timeline for this send
    setStep(1);
    const f = reduce ? 0.05 : 1;
    const ts = [
      setTimeout(() => setStep(2), 750 * f),
      setTimeout(() => setStep(3), 1250 * f),
      setTimeout(() => setStep(4), 1850 * f),
      setTimeout(() => {
        setStep(5);
        setBump((b) => b + 1);
      }, 3050 * f),
      setTimeout(() => setStep(6), 3600 * f),
      setTimeout(() => done.current(send.id), 4100 * f),
    ];
    return () => ts.forEach(clearTimeout);
  }, [send, reduce]);
  if (!send) return null;
  const { from, photo } = send;
  const cloud = { x: window.innerWidth / 2, y: 46 };
  const gx = from.left + from.width / 2 - ENV_W / 2;
  const gy = from.top + from.height / 2 - ENV_H / 2 + 26;
  const hover = { x: (ENV_W - PHOTO_W) / 2, y: -PHOTO_H - 14 };
  const flying = step >= 4;
  return (
    <div className="letter-layer" aria-hidden="true">
      <Backdrop show={step >= 4 && step < 6} />
      <CloudPuff
        x={cloud.x}
        y={cloud.y}
        show={step >= 4 && step < 6}
        bump={bump}
      />
      <motion.div
        className="letter-group"
        initial={{ x: gx, y: gy, scale: 1, opacity: 1, rotate: 0 }}
        animate={
          step >= 5
            ? {
                x: cloud.x - ENV_W / 2,
                y: cloud.y - ENV_H / 2 + 6,
                scale: 0.25,
                opacity: 0,
                rotate: 0,
              }
            : flying
              ? {
                  x: cloud.x - ENV_W / 2,
                  y: cloud.y - ENV_H / 2 + 6,
                  scale: 0.55,
                  opacity: 1,
                  rotate: [0, -7, 0],
                }
              : { x: gx, y: gy, scale: 1, opacity: 1, rotate: 0 }
        }
        transition={
          step >= 5
            ? { duration: 0.32, ease: 'easeIn' }
            : {
                duration: 1.15,
                ease: [0.45, 0, 0.15, 1],
                rotate: { duration: 1.15 },
              }
        }
      >
        <motion.div
          className="letter-env"
          initial={{ opacity: 0, scale: 0.85, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={soft}
        >
          <Envelope
            open={step < 3}
            photo={photo}
            innerY={step >= 2 ? REST_Y : hover.y}
            innerVisible={step >= 2}
          />
        </motion.div>
        {/* free copy: full camera card -> small photo hovering above the letter */}
        <motion.img
          className="letter-photo"
          src={photo}
          alt=""
          initial={{
            x: from.left - gx,
            y: from.top - gy,
            width: from.width,
            height: from.height,
            borderRadius: 18,
            opacity: 1,
          }}
          animate={{
            x: hover.x,
            y: hover.y,
            width: PHOTO_W,
            height: PHOTO_H,
            borderRadius: 8,
            opacity: step >= 2 ? 0 : 1,
          }}
          transition={{ ...soft, opacity: { duration: 0.12 } }}
        />
      </motion.div>
    </div>
  );
}

export type Receive = {
  id: string;
  photo: string;
  to: DOMRect | null;
  cloud?: { x: number; y: number };
};

// Dashboard. Steps:
// 1 page goes soft; cloud appears above the card
// 2 letter drops out of the cloud onto the card
// 3 flap opens
// 4 photo rises out of the letter
// 5 photo settles into its slot; letter fades
export function ReceiveLetter({
  item,
  onLanded,
  onDone,
}: {
  item: Receive | null;
  onLanded: () => void;
  onDone: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const landed = useRef(onLanded);
  const done = useRef(onDone);
  useEffect(() => {
    landed.current = onLanded;
    done.current = onDone;
  }, [onLanded, onDone]);
  useEffect(() => {
    if (!item) return;
    // oxlint-disable-next-line react/react-compiler -- one-off timeline for this arrival
    setStep(1);
    const f = reduce ? 0.05 : 1;
    const ts = [
      setTimeout(() => setStep(2), 550 * f),
      setTimeout(() => setStep(3), 1900 * f),
      setTimeout(() => setStep(4), 2400 * f),
      setTimeout(() => setStep(5), 2950 * f),
      setTimeout(() => {
        setStep(6);
        landed.current();
      }, 3550 * f),
      setTimeout(() => done.current(item.id), 4000 * f),
    ];
    return () => ts.forEach(clearTimeout);
  }, [item, reduce]);
  if (!item) return null;
  const vw = window.innerWidth;
  const cloud = item.cloud ?? { x: vw / 2, y: 64 };
  const to =
    item.to ?? new DOMRect(vw / 2 - 60, window.innerHeight * 0.55, 120, 90);
  const gx = to.left + to.width / 2 - ENV_W / 2;
  const gy = to.top + to.height / 2 - ENV_H / 2 + 22;
  const risen = { x: (ENV_W - PHOTO_W) / 2, y: -PHOTO_H - 10 };
  return (
    <div className="letter-layer" aria-hidden="true">
      <Backdrop show={step >= 1 && step < 4} />
      <CloudPuff x={cloud.x} y={cloud.y} show={step >= 1 && step < 4} />
      <motion.div
        className="letter-group"
        initial={{
          x: cloud.x - ENV_W / 2,
          y: cloud.y - ENV_H / 2 + 8,
          scale: 0.3,
          opacity: 0,
          rotate: 0,
        }}
        animate={
          step >= 2
            ? { x: gx, y: gy, scale: 1, opacity: 1, rotate: [6, -3, 0] }
            : {
                x: cloud.x - ENV_W / 2,
                y: cloud.y - ENV_H / 2 + 8,
                scale: 0.3,
                opacity: 0,
                rotate: 0,
              }
        }
        transition={{
          ...gentle,
          opacity: { duration: 0.3 },
          rotate: { duration: 1.2, ease: 'easeOut' },
        }}
      >
        <motion.div
          className="letter-env"
          animate={
            step >= 5
              ? { opacity: 0, y: 10, scale: 0.94 }
              : { opacity: 1, y: 0, scale: 1 }
          }
          transition={{ duration: 0.4, delay: step >= 5 ? 0.15 : 0 }}
        >
          <Envelope
            open={step >= 3}
            photo={item.photo}
            innerY={step >= 4 ? risen.y : REST_Y}
            innerVisible={step < 5}
          />
        </motion.div>
        {/* free copy: appears where the photo rose to, then grows into the slot */}
        <AnimatePresence>
          {step >= 5 && step < 6 && (
            <motion.img
              className="letter-photo"
              src={item.photo}
              alt=""
              initial={{
                x: risen.x,
                y: risen.y,
                width: PHOTO_W,
                height: PHOTO_H,
                borderRadius: 8,
                opacity: 1,
              }}
              animate={{
                x: to.left - gx,
                y: to.top - gy,
                width: to.width,
                height: to.height,
                borderRadius: 12,
                opacity: 1,
              }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={soft}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
