// A moment on this device's own clock, for the name and the date of a
// snapshot. (The core never reads the clock or the time zone itself.)

import type { LocalMoment } from '../../core/snapshots';

/** A moment (milliseconds since 1970, as the feature clock gives them) in this device's time zone. */
export function localMoment(time: number): LocalMoment {
  const moment = new Date(time);
  return {
    year: moment.getFullYear(),
    month: moment.getMonth() + 1,
    day: moment.getDate(),
    hour: moment.getHours(),
    minute: moment.getMinutes(),
    second: moment.getSeconds(),
  };
}
