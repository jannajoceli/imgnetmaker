/**
 * "Build network" step: shown once images are ready.
 *
 * - CSV mode: the rows already carry the metadata, so users only pick columns.
 * - Folder mode: users can attach a metadata CSV; it is matched to the image
 *   filenames here, so no spreadsheet joining is needed.
 */
class NetworkWidget extends BaseWidgetClass {

    constructor(elementId, parent) {
        super(elementId, parent);
        this.source = null;
        this.metaRows = null;
        this.joinedRows = null;
        this.initEvents();
    }

    initEvents() {
        document.getElementById('networkMetaFile').addEventListener(
            'change', (e) => this.loadMetadata(e.target)
        );
        document.getElementById('networkMetaColumn').addEventListener(
            'change', () => this.joinMetadata()
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
        document.getElementById('networkMetaFile').value = '';
        document.getElementById('networkMetaName').textContent = '';
        document.getElementById('networkMetaColumn').innerHTML = '';
        document.getElementById('networkMetaColumnWrapper').classList.add('hide');
        document.getElementById('networkMetaReport').textContent = '';
        document.getElementById('networkColumns').innerHTML = '';
        document.getElementById('networkReport').textContent = '';
    }

    setSource(dataSource) {
        this.reset();
        this.source = dataSource;
        this.renderColumns();
    }

    rows() {
        if (this.joinedRows) return this.joinedRows;
        return this.source ? this.source.data : [];
    }

    /**
     * Column checkboxes, built from whatever the rows hold
     */
    renderColumns() {
        const container = document.getElementById('networkColumns');
        const previous = new Set(this.selectedColumns());
        container.innerHTML = '';

        const rows = this.rows();
        const columns = new Set();
        rows.forEach(r => Object.keys(r).forEach(k => {
            if (!k.startsWith('inm_') && k !== 'fileobject') columns.add(k);
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
        if (!input.files.length) return;
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
                saveAs(blob, 'imgnetmaker-network.gephi-lite.json');
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
