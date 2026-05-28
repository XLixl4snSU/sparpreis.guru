"use client"

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { HelpCircle } from "lucide-react"

type FAQContext = "bestpreissuche" | "urlaubsfinder" | "direktverbindungen"

interface FAQItem {
  question: string
  answer: string
}

const bestpreissucheFaqs: FAQItem[] = [
  {
    question: "Wofür ist die Bestpreissuche gedacht?",
    answer: "Für eine feste Strecke, aber flexible Reisetage. Du gibst Start, Ziel und einen Zeitraum ein. sparpreis.guru sucht pro ausgewähltem Tag günstige Bahnverbindungen und zeigt dir, an welchen Tagen die Fahrt am billigsten ist."
  },
  {
    question: "Welche Filter werden berücksichtigt?",
    answer: "Berücksichtigt werden Reisezeitraum, Wochentage, Abfahrt-ab/bis, Ankunft-ab/bis, Alter, BahnCard-Ermäßigung, Reiseklasse, schnelle Verbindungen, Direktverbindungen, maximale Umstiege und eine Mindest-Umstiegszeit. Je enger die Filter sind, desto weniger Verbindungen können gefunden werden."
  },
  {
    question: "Was bedeuten Kalender und Tagesdetails?",
    answer: "Der Kalender zeigt den besten gefundenen Preis pro Reisetag. In den Tagesdetails siehst du konkrete Verbindungen mit Abfahrtszeit, Ankunftszeit, Dauer, Umstiegen, Preis und Buchungslink. Wenn mehrere sinnvolle Optionen existieren, werden sie nach Preis und Reisequalität eingeordnet."
  },
  {
    question: "Warum werden nur maximal 30 Tage abgefragt?",
    answer: "Jeder Reisetag löst eigene Preisabfragen aus. Damit die Suche schnell bleibt und die Bahn-API nicht unnötig belastet wird, werden maximal 30 ausgewählte Tage gesucht. Wenn du Wochentage abwählst, zählen nur die übrig gebliebenen Tage."
  },
  {
    question: "Sind die Preise verbindlich?",
    answer: "Nein. Die Preise kommen aus der Bahn-Suche und können sich ändern, bis du bei der Bahn buchst. sparpreis.guru ist eine Suchhilfe, kein Verkaufssystem. Der verbindliche Preis ist der Preis, der dir beim Öffnen des Buchungslinks bei der Bahn angezeigt wird."
  },
  {
    question: "Wie aktuell sind die Ergebnisse?",
    answer: "Die Preise werden in der Regel live abgefragt. Um doppelte Anfragen zu vermeiden, können gleiche Suchergebnisse bis zu 60 Minuten aus dem Cache kommen. In den Tagesdetails wird angezeigt, wann ein Ergebnis zuletzt aktualisiert wurde."
  },
  {
    question: "Warum sehe ich manchmal keine Preise?",
    answer: "Dann hat die Bahn-Suche für deine Kriterien keine passende Verbindung mit Preis geliefert. Häufig helfen ein größerer Zeitraum, weniger strenge Zeitfilter, mehr erlaubte Umstiege oder das Deaktivieren von Nur Direktverbindungen."
  },
  {
    question: "Was zeigt die Preishistorie?",
    answer: "Die Preishistorie erscheint nur, wenn dieselbe Verbindung schon früher gesucht wurde. Dann siehst du, ob der aktuelle Preis im Vergleich zu früheren Abfragen eher niedrig, normal oder hoch wirkt. Ohne frühere Daten wird keine Historie angezeigt."
  },
  {
    question: "Was passiert mit meinen Daten?",
    answer: "Es werden keine personenbezogenen Profile angelegt. Such- und Preisabfragen werden technisch verarbeitet und zeitweise zwischengespeichert. Bei der Bahnhofssuche werden aggregierte Auswahlzahlen gespeichert, damit häufig gewählte passende Bahnhöfe in den Vorschlägen weiter oben erscheinen."
  }
]

const urlaubsfinderFaqs: FAQItem[] = [
    {
      question: "Wofür ist der Urlaubsfinder gedacht?",
      answer: "Für den Fall, dass du weißt, wann du reisen willst, aber dein Ziel flexibel nach dem günstigsten Preis wählen willst. Du wählst deinen Startbahnhof, mögliche Reiseziele und Hin- sowie optional Rückfahrt. sparpreis.guru vergleicht die Ziele und sortiert sie nach Gesamtpreis."
    },
    {
      question: "Welche Ziele werden durchsucht?",
      answer: "Durchsucht werden nur die Ziele, die du im Formular auswählst. Du kannst Presets wie Großstädte, kleinere Städte oder europäische Ziele nutzen, einzelne Städte abwählen oder Regionen komplett hinzufügen. Je mehr Ziele ausgewählt sind, desto länger dauert die Suche."
    },
    {
      question: "Was bedeutet der Gesamtpreis?",
      answer: "Mit Rückfahrt ist der Gesamtpreis die Summe aus günstigster gefundener Hinfahrt und günstigster gefundener Rückfahrt für dieses Ziel. Ohne Rückfahrt wird nur die Hinfahrt bewertet. Die Ergebnisliste ist nach diesem Gesamtpreis sortiert."
    },
    {
      question: "Welche Filter werden berücksichtigt?",
      answer: "Berücksichtigt werden Startbahnhof, ausgewählte Ziele, Hinreisedatum, optionales Rückreisedatum, Abfahrts- und Ankunftszeitfenster für Hin- und Rückfahrt, Alter, BahnCard-Ermäßigung, Reiseklasse, schnelle Verbindungen, Direktverbindungen, maximale Umstiege und Mindest-Umstiegszeit."
    },
    {
      question: "Was zeigen Karte und Details?",
      answer: "Die Karte zeigt alle gefundenen Ziele mit Preis-Markern. Günstigere Ziele werden grün, mittlere gelb und teurere rot dargestellt. In den Details siehst du Abfahrts- und Ankunftszeiten, Preise für Hin- und Rückfahrt, Umstiege, Routenverlauf und Buchungslinks."
    },
    {
      question: "Warum muss ich große Suchen bestätigen?",
      answer: "Ab mehr als 25 ausgewählten Zielen fragt der Urlaubsfinder vor dem Start nach. Jedes Ziel kann mehrere Bahn-Abfragen auslösen, besonders mit Rückfahrt. Die Bestätigung verhindert versehentlich sehr lange oder unnötig große Suchen."
    },
    {
      question: "Sind die Preise verbindlich?",
      answer: "Nein. Die Preise kommen aus der Bahn-Suche und können sich ändern, bis du bei der Bahn buchst. sparpreis.guru hilft beim Vergleichen. Der verbindliche Preis ist der Preis, den dir die Bahn nach dem Öffnen des Buchungslinks anzeigt."
    },
    {
      question: "Warum fehlen manche Ziele?",
      answer: "Ein Ziel erscheint nur in der Ergebnisliste, wenn für deine Kriterien eine passende Verbindung mit Preis gefunden wurde. Ziele ohne Treffer werden separat als nicht verfügbar angezeigt. Oft helfen weniger strenge Zeitfilter, mehr erlaubte Umstiege oder eine kleinere Zielauswahl."
    },
    {
      question: "Wie aktuell sind die Ergebnisse?",
      answer: "Die Preise werden in der Regel live abgefragt. Um doppelte Anfragen zu vermeiden, können gleiche Suchergebnisse bis zu 60 Minuten aus dem Cache kommen. Während der Suche erscheinen neue Treffer nach und nach."
    },
    {
      question: "Was passiert mit meinen Daten?",
      answer: "Es werden keine personenbezogenen Profile angelegt. Such- und Preisabfragen werden technisch verarbeitet und zeitweise zwischengespeichert. Bei der Bahnhofssuche werden aggregierte Auswahlzahlen gespeichert, damit häufig gewählte passende Bahnhöfe in den Vorschlägen weiter oben erscheinen."
    }
]

const direktverbindungenFaqs: FAQItem[] = [
  {
    question: "Wofür ist die Direktverbindungen-Seite gedacht?",
    answer: "Du wählst einen Startbahnhof und siehst alle Ziele, die laut GTFS-Daten ohne Umstieg erreichbar sind. Die Seite ist für Orientierung gedacht, nicht für Preis- oder Buchungsabfragen."
  },
  {
    question: "Was bedeutet Direktverbindung?",
    answer: "Eine Direktverbindung bedeutet, dass Start und Ziel in derselben Fahrtfolge eines Zuges vorkommen. Zwischenhalte sind möglich, aber du musst nicht umsteigen."
  },
  {
    question: "Welche Daten werden verwendet?",
    answer: "Die Direktverbindungen werden aus den freien GTFS.de-Feeds für Fernverkehr und Nahverkehr vorbereitet und als statische Datenbasis ausgeliefert. Dadurch bleibt die Suche schnell und belastet keine Live-Preis-API."
  },
  {
    question: "Wie aktuell sind die Daten?",
    answer: "Die zentrale Datenbasis wird einmal täglich neu gebaut. Die laufende App lädt neue Daten automatisch nach und speichert sie lokal zwischen. Im Ergebnisbereich wird angezeigt, von wann die aktuell geladene Datei stammt."
  },
  {
    question: "Was zeigen die Filter?",
    answer: "Du kannst alle Direktverbindungen anzeigen oder auf Fernverkehr beziehungsweise Nahverkehr eingrenzen. Zusätzlich kannst du nach maximaler Fahrtdauer und nach einer Mindestanzahl direkter Fahrten pro Tag filtern."
  },
  {
    question: "Was bedeuten Fahrten pro Tag und typische Fahrtdauer?",
    answer: "Fahrten pro Tag ist ein Durchschnitt über den Fahrplanzeitraum des GTFS-Feeds. Die typische Fahrtdauer ist der Durchschnitt der gefundenen direkten Fahrten, während die große Fahrzeitangabe die schnellste direkte Fahrt zeigt."
  },
  {
    question: "Warum sehe ich keine Preise?",
    answer: "Diese Seite zeigt das Netz erreichbarer Ziele, keine konkreten Tickets. Für Preise nutzt du die Bestpreissuche oder den Urlaubsfinder."
  }
]

export function FAQPopup({ context = "bestpreissuche" }: { context?: FAQContext }) {
  const [isOpen, setIsOpen] = useState(false)
  const faqs =
    context === "urlaubsfinder"
      ? urlaubsfinderFaqs
      : context === "direktverbindungen"
        ? direktverbindungenFaqs
        : bestpreissucheFaqs

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-600 hover:text-blue-600 hover:bg-blue-50"
        >
          <HelpCircle className="w-4 h-4 mr-2" />
          FAQ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-blue-600" />
            Häufig gestellte Fragen
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 mt-4">
          {faqs.map((faq, index) => (
            <div key={index} className="border-b border-gray-100 pb-4 last:border-b-0">
              <h3 className="font-semibold text-gray-900 mb-2">
                {faq.question}
              </h3>
              <p className="text-gray-700 leading-relaxed">
                {faq.answer}
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
