'use client';
import { useEffect, useState } from 'react';
import {
  Battery,
  BatteryCharging,
  BatteryLow,
  BatteryMedium,
} from 'lucide-react';
import { api } from '@/lib/api';

type BatteryManager = EventTarget & { level: number; charging: boolean };
export type PhonePower = { battery: number | null; charging: boolean | null };

export function usePhoneBattery(enabled: boolean) {
  const [power, setPower] = useState<PhonePower>({
    battery: null,
    charging: null,
  });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let manager: BatteryManager | undefined;
    let latest: PhonePower = { battery: null, charging: null };
    const request = new AbortController();
    const publish = () => {
      if (document.hidden || !alive) return;
      void api('/phone/heartbeat', {
        method: 'POST',
        body: JSON.stringify(latest),
        signal: request.signal,
      }).catch(() => {});
    };
    const update = () => {
      if (!alive || !manager) return;
      latest = {
        battery: Math.round(manager.level * 100),
        charging: manager.charging,
      };
      setPower(latest);
      publish();
    };
    const battery = (
      navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
    ).getBattery;
    if (battery)
      void battery
        .call(navigator)
        .then((result) => {
          if (!alive) return;
          manager = result;
          manager.addEventListener('levelchange', update);
          manager.addEventListener('chargingchange', update);
          update();
        })
        .catch(() => {});
    publish();
    const timer = setInterval(publish, 15000);
    document.addEventListener('visibilitychange', publish);
    return () => {
      alive = false;
      request.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', publish);
      manager?.removeEventListener('levelchange', update);
      manager?.removeEventListener('chargingchange', update);
    };
  }, [enabled]);
  return power;
}

export function PhoneBattery({ battery, charging }: PhonePower) {
  const Icon = charging
    ? BatteryCharging
    : battery === null
      ? Battery
      : battery <= 20
        ? BatteryLow
        : battery < 70
          ? BatteryMedium
          : Battery;
  const label =
    battery === null
      ? 'Battery level unavailable in this browser; check your phone’s status bar.'
      : `${battery}% battery${charging ? ', charging' : ''}`;
  return (
    <span
      className={`phone-power ${battery !== null && battery <= 20 && !charging ? 'is-low' : ''}`}
      title={label}
      aria-label={label}
    >
      <Icon aria-hidden="true" />
      <span>{battery === null ? 'Battery —' : `${battery}%`}</span>
    </span>
  );
}
