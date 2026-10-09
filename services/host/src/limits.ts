/** The SDK's structured /usage returns percentages (0–100), unlike rate-limit event fractions. */
export type SeatLimits = {
  five_hour: { used_percentage: number; resets_at: string | null };
  seven_day: { used_percentage: number; resets_at: string | null };
  at: number;
};

export async function readSeatLimits(query: {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts: { skipBehaviors: boolean }) => Promise<unknown>;
}): Promise<SeatLimits | null> {
  try {
    const data = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.({ skipBehaviors: true }) as any;
    const window = (w: any) => w && typeof w.utilization === "number" && Number.isFinite(w.utilization) && w.utilization >= 0 && w.utilization <= 100
      ? { used_percentage: w.utilization, resets_at: typeof w.resets_at === "string" && Number.isFinite(Date.parse(w.resets_at)) ? w.resets_at : null } : null;
    const five_hour = window(data?.rate_limits?.five_hour), seven_day = window(data?.rate_limits?.seven_day);
    return data?.rate_limits_available === true && five_hour && seven_day ? { five_hour, seven_day, at: Date.now() } : null;
  } catch {
    // Never log SDK errors: the credential or response may be embedded in them. Keep the last read's timestamp.
    return null;
  }
}
