import { moment, App, MarkdownSectionInformation, ButtonComponent, TextComponent } from "obsidian";
import { SimpleTimeTrackerSettings } from "./settings";

export interface Tracker {
    entries: Entry[];
}

export interface Entry {
    name: string;
    namePar: HTMLElement;
    nameBox: TextComponent ;
    startTime: number;
    endTime: number;
    subEntries: Entry[];
    editbutton: ButtonComponent;
}

export async function saveTracker(tracker: Tracker, app: App, section: MarkdownSectionInformation): Promise<void> {
    let file = app.workspace.getActiveFile();
    if (!file)
        return;
    let content = await app.vault.read(file);

    // figure out what part of the content we have to edit
    let lines = content.split("\n");
    let prev = lines.filter((_, i) => i <= section.lineStart).join("\n");
    let next = lines.filter((_, i) => i >= section.lineEnd).join("\n");
    // edit only the code block content, leave the rest untouched
    content = `${prev}\n${JSON.stringify(tracker)}\n${next}`;

    await app.vault.modify(file, content);
}

export function loadTracker(json: string): Tracker {
    if (json) {
        try {
            return JSON.parse(json);
        } catch (e) {
            console.log(`Failed to parse Tracker from ${json}`);
        }
    }
    return { entries: [] };
}

export function displayTracker(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: SimpleTimeTrackerSettings): void {
    // add start/stop controls


    let running = isRunning(tracker);
    let btn = new ButtonComponent(element)
        .setClass("clickable-icon")
        .setIcon(`lucide-${running ? "stop" : "play"}-circle`)
        .setTooltip(running ? "End" : "Start")
        .onClick(async () => {
            if (running) {
		try {
		    let entry =  getRunningEntry(tracker.entries);
                    endRunningEntry(tracker);
		    entry.name=newSegmentNameBox.getValue();
                    startNewEntry(tracker, "TBD");
		}
		catch (error) { alert(error);}
		
            } else {
                startNewEntry(tracker, newSegmentNameBox.getValue());
            }
            await saveTracker(tracker, this.app, getSectionInfo());
        });
    btn.buttonEl.addClass("simple-time-tracker-btn");
    let newSegmentNameBox = new TextComponent(element)
        .setPlaceholder("Segment name")
        .setDisabled(!running)
    newSegmentNameBox.inputEl.addClass("simple-time-tracker-txt");

    // add timers
    let timer = element.createDiv({ cls: "simple-time-tracker-timers" });
    let currentDiv = timer.createEl("div", { cls: "simple-time-tracker-timer" });
    let current = currentDiv.createEl("span", { cls: "simple-time-tracker-timer-time" });
    currentDiv.createEl("span", { text: "Current" });
    let totalDiv = timer.createEl("div", { cls: "simple-time-tracker-timer" });
    let total = totalDiv.createEl("span", { cls: "simple-time-tracker-timer-time", text: "0s" });
    totalDiv.createEl("span", { text: "Today's Total" });

    if (tracker.entries.length > 0) {
        // add table
        let table = element.createEl("table", { cls: "simple-time-tracker-table" });
        table.createEl("tr").append(
            createEl("th", { text: "Segment" }),
            createEl("th", { text: "Start time" }),
            createEl("th", { text: "End time" }),
            createEl("th", { text: "Duration" }),
            createEl("th"));

	let previous=0;
        for (let entry of tracker.entries)
	{
	    if (moment.unix(previous).format("DD")!=moment.unix(entry.startTime).format("DD"))
	    {
		let td=table.createEl ("tr") .createEl ("td");
		td.colSpan=4;
		td.createEl ("hr");

		td=table.createEl ("tr") .createEl ("td", { text: moment.unix(entry.startTime).format("ddd, MMM DD, YYYY") });
		td.colSpan=4;
		td.style.textAlign="center";
		
		

		td=table.createEl ("tr") .createEl ("td");
		td.colSpan=4;
		td.createEl ("hr");
	    }	
            addEditableTableRow(tracker, entry, table, newSegmentNameBox, running, getSectionInfo, settings, 0);
	    previous=entry.endTime;
	}



        // add copy buttons
        let buttons = element.createEl("div", { cls: "simple-time-tracker-bottom" });
        new ButtonComponent(buttons)
            .setButtonText("Copy as table")
            .onClick(() => navigator.clipboard.writeText(createMarkdownTable(tracker, settings)));
        new ButtonComponent(buttons)
            .setButtonText("Copy as TTL")
            .onClick(() => navigator.clipboard.writeText(createRDFTable(tracker,settings)));
        new ButtonComponent(buttons)
            .setButtonText("Copy as CSV")
            .onClick(() => navigator.clipboard.writeText(createCsv(tracker, settings)));
    }


    setCountdownValues(tracker, current, total, currentDiv);
    let intervalId = window.setInterval(() => {
        // we delete the interval timer when the element is removed
        if (!element.isConnected) {
            window.clearInterval(intervalId);
            return;
        }
        setCountdownValues(tracker, current, total, currentDiv);
    }, 1000);
}

function startSubEntry(entry: Entry, name: string) {
    // if this entry is not split yet, we add its time as a sub-entry instead
    if (!entry.subEntries) {
        entry.subEntries = [{ ...entry, name: `Part 1` }];
        entry.startTime = null;
        entry.endTime = null;
    }

    if (!name)
        name = `Part ${entry.subEntries.length + 1}`;
    entry.subEntries.push({ name: name, startTime: moment().unix(), endTime: null, subEntries: null });
}

function startNewEntry(tracker: Tracker, name: string): void {
    if (!name)
        name = `Segment ${tracker.entries.length + 1}`;
    let entry: Entry = { name: name, startTime: moment().unix(), endTime: null, subEntries: null };
    tracker.entries.push(entry);
};

function endRunningEntry(tracker: Tracker): void {
    let entry = getRunningEntry(tracker.entries);
    entry.endTime = moment().unix();
}

function removeEntry(entries: Entry[], toRemove: Entry): boolean {
    if (entries.contains(toRemove)) {
        entries.remove(toRemove);
        return true;
    } else {
        for (let entry of entries) {
            if (entry.subEntries && removeEntry(entry.subEntries, toRemove)) {
                // if we only have one sub entry remaining, we can merge back into our main entry
                if (entry.subEntries.length == 1) {
                    let single = entry.subEntries[0];
                    entry.startTime = single.startTime;
                    entry.endTime = single.endTime;
                    entry.subEntries = null;
                }
                return true;
            }
        }
    }
    return false;
}

function isRunning(tracker: Tracker): boolean {
    return !!getRunningEntry(tracker.entries);
}

function getRunningEntry(entries: Entry[]): Entry {
    for (let entry of entries) {
        // if this entry has sub entries, check if one of them is running
        if (entry.subEntries) {
            let running = getRunningEntry(entry.subEntries);
            if (running)
                return running;
        } else {
            // if this entry has no sub entries and no end time, it's running
            if (!entry.endTime)
                return entry;
        }
    }
    return null;
}

function getDuration(entry: Entry) {
    if (entry.subEntries) {
        return getTotalDuration(entry.subEntries);
    } else {
        let endTime = entry.endTime ? moment.unix(entry.endTime) : moment();
        return endTime.diff(moment.unix(entry.startTime));
    }
}

function getTotalDuration(entries: Entry[]): number {
    let ret = 0;
    for (let entry of entries)
        ret += getDuration(entry);
    return ret;
}

function getTodaysDuration(entries: Entry[]): number {
    let ret = 0;
    for (let entry of entries)
	if (moment.unix(entry.startTime).format("MM/DD/YYYY")==moment().format("MM/DD/YYYY")) {
            ret += getDuration(entry);
	}
    return ret;
}

function setCountdownValues(tracker: Tracker, current: HTMLElement, total: HTMLElement, currentDiv: HTMLDivElement) {
    let running = getRunningEntry(tracker.entries);
    if (running && !running.endTime) {
        current.setText(formatDuration(getDuration(running)));
        currentDiv.hidden = false;
    } else {
        currentDiv.hidden = true;
    }
    total.setText(formatDuration(getTodaysDuration(tracker.entries)));
}

function formatTimestamp(timestamp: number, settings: SimpleTimeTrackerSettings): string {
    //    return moment.unix(timestamp).format(settings.timestampFormat);
    return moment.unix(timestamp).format("MM/DD/YYYY HH:mm");
}

function formatDuration(totalTime: number): string {
    let duration = moment.duration(totalTime);
    let ret = "";
    if (duration.years() > 0)
	ret += duration.years() + "y ";
    if (duration.months() > 0)
	ret += duration.months() + "m ";
    if (duration.days() > 0)
	ret += duration.days() + "d ";
    if (duration.hours() > 0)
        ret += duration.hours() + "h ";
    if (duration.minutes() > 0)
        ret += duration.minutes() + "m ";
//    ret += duration.seconds() + "s";
    return ret;
}

function createMarkdownTable(tracker: Tracker, settings: SimpleTimeTrackerSettings): string {
    let table = [["Segment", "Start time", "End time", "Duration"]];
    for (let entry of tracker.entries)
        table.push(...createTableSection(entry, settings));
    table.push(["**Total**", "", "", `**${formatDuration(getTotalDuration(tracker.entries))}**`]);

    let ret = "";
    // calculate the width every column needs to look neat when monospaced
    let widths = Array.from(Array(4).keys()).map(i => Math.max(...table.map(a => a[i].length)));
    for (let r = 0; r < table.length; r++) {
        // add separators after first row
        if (r == 1)
            ret += Array.from(Array(4).keys()).map(i => "-".repeat(widths[i])).join(" | ") + "\n";

        let row: string[] = [];
        for (let i = 0; i < 4; i++)
            row.push(table[r][i].padEnd(widths[i], " "));
        ret += row.join(" | ") + "\n";
    }
    return ret;
}



function createRDFTable(tracker: Tracker, settings: SimpleTimeTrackerSettings): string {
    let RDF = "prefix ts: <https://business.data.world/timesheet>\nprefix xsd: <http://www.w3.org/2001/XMLSchema#>\nprefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n";
    for (let entry of tracker.entries)
        RDF += createRDFSection(entry, settings);


    let token="eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJwcm9kLXVzZXItY2xpZW50OmRhbGxlbWFuZyIsImlzcyI6ImFnZW50OmRhbGxlbWFuZzo6Zjc0YjcwY2QtMDU5NS00NTFiLTlhODktMjc5YmU1ZTNkZjFjIiwiaWF0IjoxNjU1MTU4MjI3LCJyb2xlIjpbInN1cHBvcnRfdGVhbSIsInVzZXJfYXBpX3JlYWQiLCJ1c2VyX2FwaV93cml0ZSJdLCJnZW5lcmFsLXB1cnBvc2UiOnRydWUsInNhbWwiOnsic3BhcmtsZXNxdWFkIjotMX19.lVeJLyhkkBNLYihL8w2RTmAmn3anP5R5YQc4EF7vTdRapd1reE4tEH-K1Zc5avAgTWvXaUlDp2fxzmjYzQGEog";
    
    var xmlHttp = new XMLHttpRequest();
    try {
	xmlHttp.open( "PUT", "https://api.data.world/v0/uploads/deansbookkeeping/timesheets/files/timesheet2.ttl?token="+token, false ); // false for synchronous request
	xmlHttp.setRequestHeader("Content-Type", "application/json");

	xmlHttp.setRequestHeader('Authorization', 'Bearer '+token);

	xmlHttp.send( RDF );

	alert ("Data sent to data.world");

//	alert (JSON.parse(xmlHttp.responseText));
    } catch (error) { alert(error);}

    
    return RDF;
}

function standardTimestamp (timestamp): string {
    let ans=moment.unix(timestamp).format("YYYY-MM-DDThh:mm:ss");
    return ans ;
}


function createRDFSection(entry: Entry, settings: SimpleTimeTrackerSettings): string {
    let reg=/[^a-zA-Z0-9]/g
    let iri = "<https://business.data.world/data/timesheets/TE"
	+entry.name.replace(reg,"")
	+formatTimestamp(entry.startTime,settings).replace(reg,"")
	+formatTimestamp(entry.endTime,settings).replace(reg,"")
	+">";
    let contents= iri
	+ " a ts:Entry ;\n"
	+ "   rdfs:label \"" + entry.name + "\" ;\n"
	+ "   ts:startTime \"" + standardTimestamp(entry.startTime ) +"\"^^xsd:dateTime ;\n"
	+ "   ts:endTime \"" + standardTimestamp(entry.endTime) +"\"^^xsd:dateTime ;\n"
	+ "   ts:duration " + getDuration(entry)/60000.0
	+ " . \n";

    return contents;
}



function createCsv(tracker: Tracker, settings: SimpleTimeTrackerSettings): string {
    let ret = "";
    for (let entry of tracker.entries) {
        for (let row of createTableSection(entry, settings))
            ret += row.join(settings.csvDelimiter) + "\n";
    }
    return ret;
}


function createTableSection(entry: Entry, settings: SimpleTimeTrackerSettings): string[][] {
    let ret: string[][] = [[
        entry.name,
        entry.startTime ? formatTimestamp(entry.startTime, settings) : "",
        entry.endTime ? formatTimestamp(entry.endTime, settings) : "",
        entry.endTime || entry.subEntries ? formatDuration(getDuration(entry)) : ""]];
    if (entry.subEntries) {
        for (let sub of entry.subEntries)
            ret.push(...createTableSection(sub, settings));
    }
    return ret;
}

function addEditableTableRow(tracker: Tracker, entry: Entry, table: HTMLTableElement, newSegmentNameBox: TextComponent, running: boolean, getSectionInfo: () => MarkdownSectionInformation, settings: SimpleTimeTrackerSettings, indent: number) {
    let row = table.createEl("tr");

    let name = row.createEl("td");
    let namePar = name.createEl("span", { text: entry.name });
    namePar.style.marginLeft = `${indent}em`;
    let nameBox = new TextComponent(name).setValue(entry.name);
    nameBox.inputEl.hidden = true;

    //    row.createEl("td", { text: entry.startTime ? formatTimestamp(entry.startTime, settings) : "" });


    let start = row.createEl("td");
    let startPar = start.createEl("span", { text: entry.startTime ? moment.unix(entry.startTime).format("H:mm") : "" });
    startPar.style.marginLeft = `${indent}em`;
    let startBox = new TextComponent(start).setValue(entry.startTime ? formatTimestamp(entry.startTime, settings) : "" );
    startBox.inputEl.hidden = true;

    
    //    row.createEl("td", { text: entry.endTime ? formatTimestamp(entry.endTime, settings) : "" });


    let end = row.createEl("td");

    let endPar = end.createEl("span", { text: entry.endTime ? moment.unix(entry.endTime).format("H:mm") : "" });
    endPar.style.marginLeft = `${indent}em`;
    let endBox = new TextComponent(end).setValue(entry.endTime ? formatTimestamp(entry.endTime, settings) : "" );
    endBox.inputEl.hidden = true;

    
    row.createEl("td", { text: entry.endTime || entry.subEntries ? formatDuration(getDuration(entry)) : "" });

    let entryButtons = row.createEl("td");
    if (!running) {
        new ButtonComponent(entryButtons)
            .setClass("clickable-icon")
            .setIcon(`lucide-play`)
            .setTooltip("Continue")
            .onClick(async () => {
                startSubEntry(entry, newSegmentNameBox.getValue());
                await saveTracker(tracker, this.app, getSectionInfo());
            });
    }
    let editButton = new ButtonComponent(entryButtons)
        .setClass("clickable-icon")
        .setTooltip("Edit")
        .setIcon("lucide-pencil")
        .onClick(async () => {
            if (namePar.hidden) {
                namePar.hidden = false;
                nameBox.inputEl.hidden = true;
                editButton.setIcon("lucide-pencil");
                if (nameBox.getValue()) {
                    entry.name = nameBox.getValue();
                    namePar.setText(entry.name);
                    await saveTracker(tracker, this.app, getSectionInfo());
                }
            } else {
                namePar.hidden = true;
                nameBox.inputEl.hidden = false;
                nameBox.setValue(entry.name);
                editButton.setIcon("lucide-check");
            }



	    
            if (startPar.hidden) {
                startPar.hidden = false;
                startBox.inputEl.hidden = true;
                editButton.setIcon("lucide-pencil");
                if (startBox.getValue()) {
                    entry.startTime =moment.unix (Date.parse(startBox.getValue())/1000).format( "X");
                    startPar.setText(entry.startTime ?  moment.unix(entry.startTime).format("H:mm") : "" );
                    await saveTracker(tracker, this.app, getSectionInfo());
                }
            } else {
                startPar.hidden = true;
                startBox.inputEl.hidden = false;
                startBox.setValue(formatTimestamp(entry.startTime,settings));
                editButton.setIcon("lucide-check");
            }


            if (endPar.hidden) {
                endPar.hidden = false;
                endBox.inputEl.hidden = true;
                editButton.setIcon("lucide-pencil");
                if (endBox.getValue()) {
                    entry.endTime =moment.unix (Date.parse(endBox.getValue())/1000).format( "X");
                    endPar.setText(entry.endTime ?  moment.unix(entry.endTime).format("H:mm") : "" );
                    await saveTracker(tracker, this.app, getSectionInfo());
                }
            } else {
                endPar.hidden = true;
                endBox.inputEl.hidden = false;
                endBox.setValue(formatTimestamp(entry.endTime,settings));
                editButton.setIcon("lucide-check");
            }

	    
	});
    entry.editbutton = editButton ;
    entry.namePar = namePar ;
    entry.nameBox = nameBox;
    new ButtonComponent(entryButtons)
        .setClass("clickable-icon")
        .setTooltip("Remove")
        .setIcon("lucide-trash")
        .onClick(async () => {
            removeEntry(tracker.entries, entry);
            await saveTracker(tracker, this.app, getSectionInfo());
        });

    if (entry.subEntries) {
        for (let sub of entry.subEntries)
            addEditableTableRow(tracker, sub, table, newSegmentNameBox, running, getSectionInfo, settings, indent + 1);
    }
}
