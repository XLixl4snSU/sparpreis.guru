// Hilfsfunktionen für DayDetailsModal

export function getPersonCode(alter: string) {
  switch (alter) {
    case "ERWACHSENER": return "13"
    case "KIND": return "11"
    case "SENIOR": return "12"
    case "JUGENDLICHER": return "9"
    default: return "13"  // Default to ERWACHSENER if unknown
  }
}

export function getDiscountCode(ermaessigungArt: string, ermaessigungKlasse: string) {
  if (ermaessigungArt === "BAHNCARD25" && ermaessigungKlasse === "KLASSE_1") return "17"
  if (ermaessigungArt === "BAHNCARD25" && ermaessigungKlasse === "KLASSE_2") return "17"
  if (ermaessigungArt === "BAHNCARD50" && ermaessigungKlasse === "KLASSE_1") return "23"
  if (ermaessigungArt === "BAHNCARD50" && ermaessigungKlasse === "KLASSE_2") return "23"
  if (ermaessigungArt === "KEINE_ERMAESSIGUNG") return "16"
  return "0"
}

export function getRParam(
  alter: string,
  ermaessigungArt: string,
  ermaessigungKlasse: string,
  klasse: string
) {
  const personCode = getPersonCode(alter)
  const discountCode = getDiscountCode(ermaessigungArt, ermaessigungKlasse)
  // KLASSENLOS if discountCode is "16" (KEINE_ERMAESSIGUNG)
  const klasseValue = discountCode === "16" ? "KLASSENLOS" : klasse
  return `${personCode}:${discountCode}:${klasseValue}:1`
}

export function createBookingLink(
  abfahrtsZeitpunkt: string,
  startStationName: string,
  zielStationName: string,
  startStationId: string,
  zielStationId: string,
  klasse: string,
  maximaleUmstiege: string,
  alter: string,
  ermaessigungArt: string,
  ermaessigungKlasse: string,
  umstiegszeit?: string
): string {
  if (!abfahrtsZeitpunkt || !startStationId || !zielStationId) {
    return ""
  }
  const klasseParam = klasse === "KLASSE_1" ? "1" : "2"
  const direktverbindung = maximaleUmstiege === "0" ? "true" : "false"
  const rParam = getRParam(alter, ermaessigungArt, ermaessigungKlasse, klasse)
  // Departure time should not be encoded
  let url = `https://www.bahn.de/buchung/fahrplan/suche#sts=true`
  url += `&so=${encodeURIComponent(startStationName)}`
  url += `&zo=${encodeURIComponent(zielStationName)}`
  url += `&kl=${klasseParam}`
  url += `&r=${rParam}`
  url += `&soid=${encodeURIComponent(startStationId)}`
  url += `&zoid=${encodeURIComponent(zielStationId)}`
  url += `&hd=${abfahrtsZeitpunkt}`
  url += `&hza=D&hz=%5B%5D&ar=false&s=true`
  url += `&d=${direktverbindung}`
  url += `&vm=00,01,02,03,04,05,06,07,08,09&fm=false&bp=true&dlt=false&dltv=false`
  if (umstiegszeit && umstiegszeit !== "normal") {
    url += `&mud=${umstiegszeit}`
  }
  return url
}

export function getAlterLabel(alter: string | undefined) {
  switch (alter) {
    case "KIND": return "Kind (6–14 Jahre)"
    case "JUGENDLICHER": return "Jugendlicher (15–26 Jahre)"
    case "ERWACHSENER": return "Erwachsener (27–64 Jahre)"
    case "SENIOR": return "Senior (ab 65 Jahre)"
    default: return alter || "-"
  }
}

export function calculateDuration(departure: string, arrival: string) {
  const dep = new Date(departure)
  const arr = new Date(arrival)
  const duration = arr.getTime() - dep.getTime()
  const hours = Math.floor(duration / (1000 * 60 * 60))
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}min`
}

export function getDurationMinutes(departure: string, arrival: string) {
  const dep = new Date(departure)
  const arr = new Date(arrival)
  return Math.round((arr.getTime() - dep.getTime()) / 60000)
}