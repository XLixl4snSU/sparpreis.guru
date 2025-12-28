"use client"

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { HelpCircle, X } from "lucide-react"

export function FAQPopup() {
  const [isOpen, setIsOpen] = useState(false)

  const faqs = [
    {
      question: "Was ist sparpreis.guru?",
      answer: "Der sparpreis.guru demonstriert die technische Machbarkeit, die Preise aus der Sparpreissuche der Deutschen Bahn automatisiert abzufragen, zu filtern und in einem Kalender übersichtlich darzustellen, um die günstigsten Reisetage zu finden."
    },
    {
      question: "Warum werden nur maximal 30 Tage abgefragt?",
      answer: "Unnötige Anfragen an die API der Bahn sollen vermieden werden. 30 Tage sollte für die meisten Anwendugsfälle ausreichen."
    },
    {
      question: "Wie aktuell sind die Preise?",
      answer: "Die Preise werden in Regel in Echtzeit von der Deutschen Bahn abgerufen. Ergebnisse werden allerdings für 60 Minuten zwischengespeichert, um unnötige Mehrfachanfragen zu vermeiden."
    },
    {
      question: "Wie funktioniert die Preishistorie?",
      answer: "Die Preishistorie zeigt an, wie sich die Preise für eine bestimmte Verbindung im Laufe der Zeit verändert haben – sofern für diese Verbindung bereits frühere Preisdaten vorliegen. Sie wird nur angezeigt, wenn die gleiche Suche schon einmal zu einem früheren Zeitpunkt durchgeführt wurde. Ist das nicht der Fall, gibt es keine Preishistorie für diese Verbindung."
    },
    {
      question: "Was passiert mit meinen Daten?",
      answer: "Es werden keine personenbezogene Daten gespeichert. Ausschließlich die Suchparameter werden gespeichert und verarbeitet."
    }
  ]

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