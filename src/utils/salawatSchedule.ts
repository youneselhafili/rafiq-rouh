import moment from 'moment-timezone';

export interface SalawatScheduleInput {
    scheduleMode: 'interval' | 'fixed';
    intervalHours: number;
    fixedTimes: string[];
    timezone: string;
}

export function validSalawatTimezone(value: string): boolean {
    return Boolean(moment.tz.zone(value));
}

export function calculateNextSalawatRun(
    schedule: SalawatScheduleInput,
    from: moment.Moment = moment(),
): moment.Moment {
    if (schedule.scheduleMode !== 'fixed' || !schedule.fixedTimes.length) {
        return from.clone().add(schedule.intervalHours || 4, 'hours');
    }

    const timezone = validSalawatTimezone(schedule.timezone) ? schedule.timezone : 'Africa/Casablanca';
    const localNow = from.clone().tz(timezone);
    const candidates = schedule.fixedTimes.flatMap(time => {
        const [hour, minute] = time.split(':').map(Number);
        return [0, 1].map(offset => localNow.clone().add(offset, 'days')
            .hour(hour).minute(minute).second(0).millisecond(0));
    }).filter(value => value.isAfter(localNow)).sort((a, b) => a.valueOf() - b.valueOf());

    return candidates[0] || localNow.clone().add(1, 'day');
}
