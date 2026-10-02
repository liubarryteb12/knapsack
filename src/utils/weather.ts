/** 阶段11：天气（Open-Meteo，免 Key）。离线或失败时返回 null，调用方隐藏整个区域 */

export interface DayWeather {
  date: string
  /** WMO 天气代码（UI 据此选图标） */
  code: number
  /** 天气代码 → 中文描述 */
  desc: string
  tempMaxC: number
  tempMinC: number
  precipProbPct: number
}

interface GeoResult {
  latitude: number
  longitude: number
}

const WMO_MAP: Record<number, { desc: string }> = {
  0: { desc: '晴' },
  1: { desc: '大致晴' },
  2: { desc: '多云' },
  3: { desc: '阴' },
  45: { desc: '雾' },
  48: { desc: '雾凇' },
  51: { desc: '毛毛雨' },
  53: { desc: '毛毛雨' },
  55: { desc: '毛毛雨' },
  61: { desc: '小雨' },
  63: { desc: '中雨' },
  65: { desc: '大雨' },
  71: { desc: '小雪' },
  73: { desc: '中雪' },
  75: { desc: '大雪' },
  80: { desc: '阵雨' },
  81: { desc: '阵雨' },
  82: { desc: '强阵雨' },
  95: { desc: '雷雨' },
  96: { desc: '雷雨伴冰雹' },
  99: { desc: '雷雨伴冰雹' },
}

function wmoDesc(code: number): string {
  return WMO_MAP[code]?.desc ?? '未知'
}

/** 地理编码：城市名 → 坐标 */
async function geocode(city: string): Promise<GeoResult | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!resp.ok) return null
  const data = (await resp.json()) as { results?: GeoResult[] }
  return data.results?.[0] ?? null
}

/** 查询行程日期范围内（未来 7 天内）的预报 */
export async function fetchWeather(
  destCity: string,
  dates: string[],
): Promise<Map<string, DayWeather> | null> {
  try {
    if (!destCity || dates.length === 0) return null
    const geo = await geocode(destCity)
    if (!geo) return null
    const start = dates[0]!
    const end = dates[dates.length - 1]!
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&start_date=${start}&end_date=${end}&timezone=auto`
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return null
    const data = (await resp.json()) as {
      daily?: {
        time: string[]
        weather_code: number[]
        temperature_2m_max: number[]
        temperature_2m_min: number[]
        precipitation_probability_max: Array<number | null>
      }
    }
    const daily = data.daily
    if (!daily) return null
    const out = new Map<string, DayWeather>()
    for (let i = 0; i < daily.time.length; i++) {
      const date = daily.time[i]
      const code = daily.weather_code[i]
      const tMax = daily.temperature_2m_max[i]
      const tMin = daily.temperature_2m_min[i]
      if (date === undefined || code === undefined || tMax === undefined || tMin === undefined) continue
      out.set(date, {
        date,
        code,
        desc: wmoDesc(code),
        tempMaxC: Math.round(tMax),
        tempMinC: Math.round(tMin),
        precipProbPct: daily.precipitation_probability_max[i] ?? 0,
      })
    }
    return out.size > 0 ? out : null
  } catch {
    // 静默降级：离线/超时/接口失败一律返回 null，界面隐藏天气区
    return null
  }
}
