// One jsPDF stub for both PDF builders: ChecklistExport.buildPDF and
// ShoppingList.buildPDF. Not named *.test.js, so vitest does not collect it.
//
// One copy rather than one per file on purpose. The whole value of this stub is
// that it models the surface the builders actually use - getTextWidth and setPage
// included, since a stub without them looks faithful only while the code never
// asks. Two copies of that would drift, and a stub that quietly stops matching
// jsPDF makes every layout test pass for the wrong reason.
//
// If a builder starts calling a jsPDF method that is missing here, the test fails
// with a TypeError rather than a wrong assertion - that is the intended behaviour.
// Add the method; do not fork the file.
//
// Text width is ~2mm per character, close enough to 8pt Helvetica to exercise the
// column limits.
export function fakeDoc() {
    const calls = { text: [], strokedRects: [], filledRects: [], saved: null, pages: 1, page: 1 };
    return {
        calls,
        setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {},
        setDrawColor() {}, setLineWidth() {},
        getTextWidth(t) { return String(t).length * 2; },
        rect(x, y, w, h, style) {
            (style === 'S' ? calls.strokedRects : calls.filledRects).push({ x, y, w, h });
        },
        text(str, x, y) { calls.text.push({ str: String(str), x, y, page: calls.page }); },
        addPage() { calls.pages++; calls.page = calls.pages; },
        setPage(p) { calls.page = p; },
        save(name) { calls.saved = name; },
        internal: {
            pageSize: { getWidth: () => 215.9, getHeight: () => 279.4 },
            getNumberOfPages: () => calls.pages,
        },
    };
}
