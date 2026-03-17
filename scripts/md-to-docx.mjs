import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ExternalHyperlink,
} from 'docx';
import { readFileSync, writeFileSync } from 'fs';

const md = readFileSync('FLEETGRAPH.md', 'utf-8');
const lines = md.split('\n');

const children = [];

// Simple table border style
const borders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
};

let i = 0;
while (i < lines.length) {
  const line = lines[i];

  // Skip empty lines
  if (line.trim() === '' || line.trim() === '---') {
    i++;
    continue;
  }

  // Skip mermaid code blocks
  if (line.trim().startsWith('```mermaid')) {
    children.push(new Paragraph({
      children: [new TextRun({ text: '[Mermaid diagram - see markdown source]', italics: true, color: '888888' })],
    }));
    while (i < lines.length && !lines[i].startsWith('```') && i > 0) i++;
    // skip closing ```
    i++;
    while (i < lines.length && lines[i].trim().startsWith('```')) i++;
    continue;
  }

  // Skip code blocks
  if (line.trim().startsWith('```')) {
    const codeLines = [];
    i++;
    while (i < lines.length && !lines[i].trim().startsWith('```')) {
      codeLines.push(lines[i]);
      i++;
    }
    i++; // skip closing ```
    children.push(new Paragraph({
      children: [new TextRun({ text: codeLines.join('\n'), font: 'Courier New', size: 18 })],
      spacing: { before: 100, after: 100 },
    }));
    continue;
  }

  // HTML comments
  if (line.trim().startsWith('<!--')) {
    i++;
    continue;
  }

  // Headings
  if (line.startsWith('# ')) {
    children.push(new Paragraph({
      text: line.replace(/^# /, ''),
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 150 },
    }));
    i++;
    continue;
  }
  if (line.startsWith('## ')) {
    children.push(new Paragraph({
      text: line.replace(/^## /, ''),
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 250, after: 120 },
    }));
    i++;
    continue;
  }
  if (line.startsWith('### ')) {
    children.push(new Paragraph({
      text: line.replace(/^### /, ''),
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    }));
    i++;
    continue;
  }

  // Tables
  if (line.trim().startsWith('|')) {
    const tableRows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      const row = lines[i].trim();
      // Skip separator rows (|---|---|)
      if (row.match(/^\|[\s\-:|]+\|$/)) {
        i++;
        continue;
      }
      const cells = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim());
      tableRows.push(cells);
      i++;
    }

    if (tableRows.length > 0) {
      const rows = tableRows.map((cells, rowIdx) =>
        new TableRow({
          children: cells.map(cell =>
            new TableCell({
              borders,
              width: { size: Math.floor(9000 / cells.length), type: WidthType.DXA },
              children: [new Paragraph({
                children: parseInlineFormatting(cell),
                spacing: { before: 40, after: 40 },
              })],
            })
          ),
        })
      );

      children.push(new Table({
        rows,
        width: { size: 9000, type: WidthType.DXA },
      }));
      children.push(new Paragraph({ text: '' }));
    }
    continue;
  }

  // Bullet points
  if (line.match(/^(\s*)- /)) {
    const indent = line.match(/^(\s*)/)[1].length;
    const text = line.replace(/^\s*- /, '');
    children.push(new Paragraph({
      children: parseInlineFormatting(text),
      bullet: { level: Math.min(Math.floor(indent / 2), 3) },
    }));
    i++;
    continue;
  }

  // Numbered lists
  if (line.match(/^\d+\. /)) {
    const text = line.replace(/^\d+\. /, '');
    children.push(new Paragraph({
      children: parseInlineFormatting(text),
      numbering: { reference: 'default-numbering', level: 0 },
    }));
    i++;
    continue;
  }

  // Regular paragraph
  children.push(new Paragraph({
    children: parseInlineFormatting(line),
    spacing: { before: 60, after: 60 },
  }));
  i++;
}

function parseInlineFormatting(text) {
  const runs = [];
  // Simple regex-based inline formatting
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);

  for (const part of parts) {
    if (!part) continue;

    // Bold
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    }
    // Inline code
    else if (part.startsWith('`') && part.endsWith('`')) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: 'Courier New', size: 20 }));
    }
    // Links
    else if (part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)) {
      const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      runs.push(new ExternalHyperlink({
        children: [new TextRun({ text: match[1], style: 'Hyperlink' })],
        link: match[2],
      }));
    }
    // Plain text
    else {
      runs.push(new TextRun({ text: part }));
    }
  }
  return runs;
}

const doc = new Document({
  numbering: {
    config: [{
      reference: 'default-numbering',
      levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
    }],
  },
  sections: [{ children }],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync('FLEETGRAPH.docx', buffer);
console.log('Created FLEETGRAPH.docx');
