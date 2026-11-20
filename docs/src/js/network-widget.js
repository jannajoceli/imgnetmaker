/**
 * "Network building" step.
 *
 * Works in three ways:
 * - After "CSV → Images": the rows already carry the metadata, so users only pick columns.
 * - After "Image folder → Data URLs": users can attach a metadata CSV; it is matched
 *   to the image filenames here, so no spreadsheet joining is needed.
 * - On its own (mode=network): users upload any CSV or JSON with one row per image
 *   (e.g. an earlier ImgNetMaker output, or a file made with their own code) and
 *   choose which column holds the image.
 */
class NetworkWidget extends BaseWidgetClass {

    constructor(elementId, parent) {
        super(elementId, parent);
        this.source = null;
        this.metaRows = null;
        this.joinedRows = null;
        this.standaloneRows = null;
        this.initEvents();
    }

    initEvents() {
        document.getElementById('networkDataFile').addEventListener(
            'change', (e) => this.loadStandalone(e.target)
        );
        document.getElementById('networkMetaFile').addEventListener(
            'change', (e) => this.loadMetadata(e.target)
        );
        document.getElementById('networkMetaColumn').addEventListener(
            'change', () => this.joinMetadata()
        );
        document.getElementById('networkImageColumn').addEventListener(
            'change', () => this.renderColumns()
        );
        document.getElementById('networkNameColumn').addEventListener(
            'change', () => this.renderColumns()
        );
        document.getElementById('networkLiteBtn').addEventListener(
            'click', () => this.download('gephi-lite')
        );
        document.getElementById('networkGexfBtn').addEventListener(
            'click', () => this.download('gexf')
        );
        document.getElementById('networkColumns').addEventListener(
            'change', () => this.updateButtons()
        );
    }

    reset() {
        this.source = null;
        this.metaRows = null;
        this.joinedRows = null;
        this.standaloneRows = null;
        document.getElementById('networkMetaFile').value = '';
        document.getElementById('networkMetaName').textContent = '';
        document.getElementById('networkMetaColumn').innerHTML = '';
        document.getElementById('networkMetaColumnWrapper').classList.add('hide');
        document.getElementById('networkMetaReport').textContent = '';
        document.getElementById('networkImageColumn').innerHTML = '';
        document.getElementById('networkNameColumn').innerHTML = '';
        document.getElementById('networkColumns').innerHTML = '';
        document.getElementById('networkReport').textContent = '';
    }

    /**
     * Called when one of the two image flows has finished
     */
    setSource(dataSource) {
        this.reset();
        this.source = dataSource;
        this.renderColumns();
    }

    /**
     * Rows used for building. In standalone mode, the chosen image and name
     * columns are mapped onto ImgNetMaker's own fields (inm_imgdataurl, inm_filename).
     */
    rows() {
        if (this.standaloneRows) {
            const imageCol = document.getElementById('networkImageColumn').value;
            const nameCol = document.getElementById('networkNameColumn').value;
            return this.standaloneRows.map((row, i) => {
                const mapped = Object.assign({}, row);
                const image = imageCol ? row[imageCol] : '';
                if (imageCol) mapped.inm_imgdataurl = image ? String(image).trim() : '';
                let name = nameCol ? row[nameCol] : '';
                if (!name && image && !String(image).startsWith('data:')) {
                    name = NetworkWidget.nameFromUrl(String(image));
                }
                mapped.inm_filename = name ? String(name).trim() : `image_${i + 1}`;
                return mapped;
            });
        }
        if (this.joinedRows) return this.joinedRows;
        return this.source ? this.source.data : [];
    }

    static nameFromUrl(url) {
        try {
            const path = new URL(url).pathname;
            return decodeURIComponent(path.split('/').filter(p => p).pop() || '');
        } catch (e) {
            return url.split(/[\\/]/).pop().split('?')[0];
        }
    }

    // ----------------------------------------------------------------
    // Standalone: CSV or JSON in, network out
    // ----------------------------------------------------------------

    loadStandalone(input) {
        if (!input.files.length) return;
        const file = input.files[0];
        document.getElementById('networkDataName').textContent = file.name;
        input.value = '';

        const done = (rows) => {
            try {
                if (!rows.length) throw Error('No rows found in the file.');
                this.reset();
                this.standaloneRows = rows;
                this.fillImageSelectors(rows);
                this.renderColumns();

                const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
                this.parent.tableWidget.showData({headers, rows});
                this.parent.clearStage();
                this.parent.setStage('network');
                this.parent.setStage('source-csv');
            } catch (error) {
                this.log('Could not read the file', error);
            }
        };

        if (/\.json$/i.test(file.name) || file.type === 'application/json') {
            file.text()
                .then(text => done(NetworkWidget.rowsFromJson(JSON.parse(text))))
                .catch(error => this.log('Could not read the JSON file', error));
        } else {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => done(results.data),
                error: (error) => this.log('Could not read the CSV file', error)
            });
        }
    }

    /**
     * Accepts an array of records, or an object holding one
     * (e.g. {"data": [...]}, {"items": [...]}, {"nodes": [...]}).
     * Lists inside a record become "a;b;c" so they can be split into values.
     */
    static rowsFromJson(json) {
        let records = Array.isArray(json) ? json : null;
        if (!records && json && typeof json === 'object') {
            records = Object.values(json).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
        }
        if (!records) throw Error('Expected a list of records, e.g. [{"image": "...", "hashtags": [...]}, ...]');

        // Nested fields become dotted columns: {"author": {"name": "ana"}} -> "author.name"
        const flatten = (obj, prefix, row, depth) => {
            Object.entries(obj).forEach(([k, v]) => {
                const key = prefix ? `${prefix}.${k}` : k;
                if (Array.isArray(v)) {
                    row[key] = v.map(x => (x && typeof x === 'object') ? JSON.stringify(x) : String(x)).join(';');
                } else if (v && typeof v === 'object') {
                    if (depth < 3) flatten(v, key, row, depth + 1);
                    else row[key] = JSON.stringify(v);
                } else if (v !== undefined && v !== null) {
                    row[key] = v;
                }
            });
            return row;
        };
        return records.filter(r => r && typeof r === 'object').map(r => flatten(r, '', {}, 0));
    }

    fillImageSelectors(rows) {
        const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
        const sample = (col) => rows.slice(0, 50).map(r => r[col]).filter(v => v !== undefined && v !== '');
        const looksLikeImage = (col) => sample(col).length > 0 && sample(col).every(v =>
            /^data:image\//i.test(v) || /^https?:\/\/\S+$/i.test(v));

        let imageGuess = headers.includes('inm_imgdataurl') ? 'inm_imgdataurl'
            : headers.find(h => sample(h).some(v => /^data:image\//i.test(v)))
            || headers.find(h => /image|img|photo|thumb|media/i.test(h) && looksLikeImage(h))
            || headers.find(looksLikeImage) || '';

        let nameGuess = headers.includes('inm_filename') ? 'inm_filename'
            : headers.find(h => /file.?name|filename|image.?id|^id$|_id$/i.test(h) && h !== imageGuess) || '';

        const fill = (id, guess, emptyLabel) => {
            const select = document.getElementById(id);
            select.innerHTML = '';
            const none = document.createElement('option');
            none.value = '';
            none.textContent = emptyLabel;
            select.appendChild(none);
            headers.forEach(h => {
                const option = document.createElement('option');
                option.value = h;
                option.textContent = h;
                select.appendChild(option);
            });
            select.value = guess;
        };
        fill('networkImageColumn', imageGuess, '(no images)');
        fill('networkNameColumn', nameGuess, '(take it from the image URL / row number)');
    }

    // ----------------------------------------------------------------
    // Shared: columns, metadata join, export
    // ----------------------------------------------------------------

    renderColumns() {
        const container = document.getElementById('networkColumns');
        const previous = new Set(this.selectedColumns());
        container.innerHTML = '';

        const imageCol = document.getElementById('networkImageColumn').value;
        const rows = this.rows();
        const columns = new Set();
        rows.forEach(r => Object.keys(r).forEach(k => {
            if (!k.startsWith('inm_') && k !== 'fileobject' && k !== imageCol) columns.add(k);
        }));

        if (!columns.size) {
            const hint = document.createElement('span');
            hint.className = 'network-hint';
            hint.textContent = 'No metadata columns yet. Add a metadata CSV to connect the images.';
            container.appendChild(hint);
        }

        columns.forEach(col => {
            const label = document.createElement('label');
            label.className = 'network-column';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.value = col;
            box.checked = previous.has(col);
            const sample = rows.map(r => r[col]).find(v => v !== undefined && v !== null && String(v).trim() !== '');
            label.title = sample ? `e.g. ${String(sample).slice(0, 80)}` : 'empty column';
            label.appendChild(box);
            label.appendChild(document.createTextNode(' ' + col));
            container.appendChild(label);
        });

        this.updateButtons();
    }

    selectedColumns() {
        return Array.from(document.querySelectorAll('#networkColumns input:checked')).map(el => el.value);
    }

    updateButtons() {
        const disabled = this.selectedColumns().length === 0;
        document.getElementById('networkLiteBtn').disabled = disabled;
        document.getElementById('networkGexfBtn').disabled = disabled;
    }

    /**
     * Folder mode: read a metadata CSV and preselect the column that
     * matches the most image filenames.
     */
    loadMetadata(input) {
        if (!input.files.length || !this.source) return;
        const file = input.files[0];
        document.getElementById('networkMetaName').textContent = file.name;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                this.metaRows = results.data;
                const select = document.getElementById('networkMetaColumn');
                select.innerHTML = '';

                const imageKeys = new Set(this.source.data.map(r => NetworkBuilder.matchKey(r.inm_filename)));
                let best = null;
                let bestHits = -1;
                results.meta.fields.forEach(field => {
                    const hits = this.metaRows.filter(r => imageKeys.has(NetworkBuilder.matchKey(r[field]))).length;
                    if (hits > bestHits) {
                        best = field;
                        bestHits = hits;
                    }
                    const option = document.createElement('option');
                    option.value = field;
                    option.textContent = field;
                    select.appendChild(option);
                });
                if (best) select.value = best;
                document.getElementById('networkMetaColumnWrapper').classList.remove('hide');
                this.joinMetadata();
            },
            error: (error) => this.log('Could not read the metadata CSV', error)
        });
        input.value = '';
    }

    joinMetadata() {
        if (!this.metaRows || !this.source) return;
        const column = document.getElementById('networkMetaColumn').value;
        const result = NetworkBuilder.joinMetadata(this.source.data, this.metaRows, column);
        this.joinedRows = result.rows;

        const total = this.source.data.length;
        let report = `Matched ${result.matched} of ${total} images.`;
        if (result.unmatchedImages.length) {
            report += ` ${result.unmatchedImages.length} image(s) without metadata` +
                ` (e.g. ${result.unmatchedImages.slice(0, 3).join(', ')}).`;
        }
        if (result.unmatchedMeta.length) {
            report += ` ${result.unmatchedMeta.length} metadata row(s) without an image.`;
        }
        document.getElementById('networkMetaReport').textContent = report;
        this.renderColumns();
    }

    download(format) {
        try {
            const network = NetworkBuilder.build(this.rows(), {
                columns: this.selectedColumns(),
                separator: document.getElementById('networkSeparator').value,
                mode: document.getElementById('networkMode').value
            });

            const s = network.stats;
            let report = `${s.images} images, ${s.values} values, ${s.edges} links.`;
            if (s.isolatedImages) report += ` ${s.isolatedImages} image(s) without links.`;
            document.getElementById('networkReport').textContent = report;

            if (format === 'gephi-lite') {
                const data = NetworkBuilder.toGephiLite(network, 'ImgNetMaker network');
                const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
                saveAs(blob, 'imgnetmaker-network-gephi-lite.json');
            } else {
                const gexf = NetworkBuilder.toGexf(network, document.getElementById('networkGexfThumbs').checked);
                const blob = new Blob([gexf], {type: 'application/xml'});
                saveAs(blob, 'imgnetmaker-network.gexf');
            }
        } catch (error) {
            document.getElementById('networkReport').textContent = error.message;
            this.log('Could not build the network', error);
        }
    }

    log(message, error) {
        this.events.emit('app:log:add', Utils.createLogEntry('error', message, {
            originalMessage: error && error.message,
            errorType: error && error.name
        }));
    }
}
