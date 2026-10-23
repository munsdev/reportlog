---
title: Maps and numbers
description: Heat maps, the counts a site publishes, counts-only logbooks, and the thresholds that keep small places from identifying anybody.
---

## Heat maps

A heat map counts reports by place. It is drawn from outlines that ship with the software, with no map tile service behind it, so showing a map tells no third party anything.

A map counts the answers to a **location** question: a country, or a US state or territory chosen from a list, and for a US question optionally the county too. Only one location question per logbook can feed a map, so pick it rather than a free-text place if the answers need to add up. County lists come from the US Census and ship with the software; no request is made to look them up.

Under **Logbooks and lists › Maps**, administrators choose:

- which location question places each logbook's or list's reports;
- each map: on or off, what feeds it, and where it appears (a page of its own, a tab on the board, beside the board's reports or numbers, or on the front page), in what order;
- each map's **threshold**: a place with fewer reports than the threshold is shown with no number at all, never just a hidden one. The default is 3; the least is 1. A map can have a separate threshold for counties.

A preview on the same screen uses the same code as the public map.

## The numbers the site publishes

The board's **Numbers** page publishes counts of approved, published reports, broken out by logbook and by question, never as one bare total. The board's **Activity** page publishes counts only: reports by origin, place and hour, declined reports by reason, and every use of the flood switches and the counts-only setting. Nothing still under review is counted anywhere. The same figures are available to other software through the [public API](/docs/reference/public-api/).

## Counts-only logbooks

A logbook can be published as **counts only**: its reports are approved as usual, but the public sees the numbers and not the reports. Set it per logbook under **Moderation › Moderation settings**.

A counts-only logbook has a **small-area threshold**: a place with fewer published reports than it is sent as a name with no number. The default is 2; the least is 1. It applies on every public count by place, whether or not a map reads the logbook; where a map's own threshold is higher, the higher one wins. Every change to it is recorded and shown on the board's activity page.

Thresholds limit what one count shows. They cannot stop all arithmetic between counts: with one place under the threshold, the logbook's total minus the places shown can reveal it. Choose thresholds with that in mind.
