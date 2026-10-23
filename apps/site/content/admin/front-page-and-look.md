---
title: Front page, wording and look
description: What the front page shows, the words a site can change, its name, and how it looks.
---

Everything here is under **Site settings** and **Logbooks and lists › Front page**, for administrators and the owner. None of it is sealed, and all of it can be changed back.

## The front page

From the top, the front page shows:

1. **A headline and a short lede**, in the site's own words.
2. **A button for every open logbook and every listed list**, wearing its title. The first is drawn in the accent colour.
3. **The help-now notice**: what to do if somebody is in danger right now. It is always shown and cannot be blanked; saving it empty brings back the shipped text. Reword it for where you are, but it stays.
4. **Quieter sections**, each shown only if an administrator turns it on, in the order they choose: an introduction, a way to check a report, a map, figures, and links.

An administrator who opens the front page sees an **Edit this page** button, which switches the page into editing in place: the words, the buttons and the sections, saved where they are. It is never offered on a door, so somebody filing without the password never sees it.

**Logbooks and lists › Front page** is the same buttons as a list: their order, their labels, which are hidden, and a way back to the shipped order.

## Wording

**Site settings › Wording** holds every piece of text the site lets you write: the front page, the About page's first part, the board's introduction, the password page, what the filing form says at the start and beside Send, the sentence shown when a form is turned away, the terms of use, the moderation standard, and others. A piece you leave empty shows nothing, rather than placeholder text.

Wording can include **figures**, numbers the site fills in: `In the last week {{ [reports.filed.7d] }} reports were filed.` A figure may only be something already public elsewhere on the site: reports filed and published, overall or per logbook, and the published counts of a listed list. Arithmetic between figures is allowed: numbers, `+ - * /`, brackets, `round(x, places)` and `percent(part, whole)`. It is parsed, never run, so nothing typed into the box can execute.

There is no bare total: whoever writes the sentence writes the qualification around the number.

## The name

**Site settings › Name** sets the site's name, shown in the header and the browser tab. Quotation marks pick out part of it in an accent colour: `Munich"Log"` draws "Log" in the brand colour, and single quotes use a second accent.

## The look

A look is a **palette**, which owns every colour, and a **theme**, which owns type, corners, shadow and page width and sets no colour. Any theme works with any palette. ReportLog ships {{palettes}} palettes and {{themes}} themes; a new site starts on Newsdesk. Every colour pairing is checked for contrast when it is built, and the status colours (a red for serious, a teal for confirmed) keep their hue in every palette, because a signal that changed colour with the decor would stop being one.

**Look packs** add more: a `.zip` an administrator uploads under Site settings › Look, checked by the same rules the built-in looks pass. Adding, replacing or removing one asks for your second factor again. Every font is served from your own site.

Readers have a switch of their own, **Easier reading**, which shows the site in high contrast with a plainer theme in their browser only.

## The development notice

**Site settings › Development notice** shows a small "under active development" notice in the corner of every page for a number of hours. Each deploy turns it on for a few hours by itself.
