/**
 * Main application controller for the Image CSV Processor
 * Orchestrates Model and View components using MVC architecture
 */
class WebApp {

    constructor() {

        this.eventBus = new EventEmitter();

        document.addEventListener('DOMContentLoaded', () => {
            this.dataModule = new DataModule(this.eventBus);
            this.requestModule = new RequestModule(this.eventBus);
            this.pageWidget = new PageWidget('pageWidget', this.eventBus);

            this.pageWidget.tableWidget.setSource(this.dataModule.getDataSource('csv'));
            this.pageWidget.folderWidget.setSource(this.dataModule.getDataSource('folder'));

            this.initEvents();
        });
    }

    initEvents() {
        this.eventBus.on('app:reset:start', () => this.actionReset());
        this.eventBus.on('app:input:changed', (data) => this.actionInput(data));
        this.eventBus.on('app:fetch:start', (data) => this.actionFetchStart(data));
        this.eventBus.on('app:fetch:stop', () => this.actionFetchStop());
        this.eventBus.on('app:batch:ready', (data) => this.onBatchReady(data));
        this.eventBus.on('app:download:start', (data) => this.actionDownload(data));
    }

    /**
     * Reset application to initial state
     */
    actionReset() {
        this.dataModule.reset();
        this.requestModule.reset();
        this.pageWidget.reset();

        this.pageWidget.tableWidget.setSource(this.dataModule.getDataSource('csv'));
        this.pageWidget.folderWidget.setSource(this.dataModule.getDataSource('folder'));
    }

     /**
     * Load CSV and update user interface
     */
    async actionInput(data) {

        try {
            const dataSource = this.dataModule.getDataSource(data.sourceName);

            const sourceSettings = this.pageWidget.fetchWidget.getSourceSettings(data);
            const result = await dataSource.load(sourceSettings);

            if (dataSource.name == 'csv') {
                this.pageWidget.fetchWidget.updateColumnSelector(result);
                this.pageWidget.tableWidget.showData(result);
            }

            if (dataSource.name == 'folder') {
                this.pageWidget.folderWidget.showData(result);
            }

            this.pageWidget.clearStage('start');
            this.pageWidget.setStage('select');
            this.pageWidget.setStage('select-column');
            this.pageWidget.setStage('source-' + dataSource.name);

        } catch (error) {
            const logEntry = Utils.createLogEntry(
                'error',
                'Could not load input data',
                {
                    originalMessage: error.message,
                    errorType: error.name
                });
            this.eventBus.emit('app:log:add', logEntry);
        }
    }

    /**
     * Start fetching
     *
     * @param {Object} data Object with keys method, sourceName, targetName
     */
    async actionFetchStart(data) {

        this.pageWidget.clearStage();
        this.pageWidget.setStage('fetch');
        this.pageWidget.setStage('source-' + data.sourceName);

        let fetchSettings = this.pageWidget.fetchWidget.getSettings(data);
        const source = this.dataModule.getDataSource(data.sourceName);
        this.requestModule.process(source, fetchSettings);
    }

    actionFetchStop() {
        this.requestModule.stop();
    }

    async actionDownload(data) {
        const target = this.dataModule.getDataTarget(data.targetName);
        const source = this.dataModule.getDataSource(data.sourceName);
        target.download(source);
    }

    onBatchReady(data) {
        this.pageWidget.clearStage();
        this.pageWidget.setStage('ready');
        this.pageWidget.setStage('ready-' + data.targetName);
        this.pageWidget.setStage('source-' + data.sourceName);

    }

}

// Initialize application
const app = new WebApp();