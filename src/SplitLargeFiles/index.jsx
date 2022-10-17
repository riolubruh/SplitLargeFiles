module.exports = (Plugin, Library) => {
    "use strict";

    const {ContextMenu, Webpack} = BdApi;
    const {byProps} = Webpack.Filters;

    const {Logger, Patcher, DiscordModules, DOMTools, PluginUtilities, Settings} = Library;
    const {SettingPanel, Slider} = Settings;
    const {Dispatcher, React, SelectedChannelStore, SelectedGuildStore, UserStore, MessageStore, Permissions, ChannelStore, MessageActions} = DiscordModules;

    // Set globals
    // const fileCheckMod = Webpack.getModule(byPrototypeFields("compressAndCheckFileSize")).prototype;
    const MessageAttachmentManager = Webpack.getModule(byProps("addFiles"));
    const FileCheckMod = Webpack.getModule(m => Object.values(m).filter(v => v?.toString).map(v => v.toString()).some(v => v.includes("getCurrentUser();") && v.includes("getUserMaxFileSize")));

    const MessageAccessories = Object.values(Webpack.getModule(m => Object.values(m).some(k => k?.prototype && Object.keys(k.prototype).includes("renderAttachments")))).find(v => v?.prototype && Object.keys(v.prototype).includes("renderAttachments"));
    const Attachment = BdApi.Webpack.getModule(m => Object.values(m).filter(v => v?.toString).map(v => v.toString()).some(s => s.includes("renderAdjacentContent")));

    const BATCH_SIZE = 10;

    // Stores a map of channel IDs to queued chunks
    const queuedUploads = new Map();

    const activeDownloads = new Map();

    async function downloadId(download) {
        if (!download) return null;
        const encoder = new TextEncoder();
        const digested = await crypto.subtle.digest("SHA-256", encoder.encode(download.urls.join("")));
        return Buffer.from(digested).toString("base64");
    }

    function getFunctionNameFromString(obj, search) {
        for (const [k, v] of Object.entries(obj)) {
            if (search.every(str => v?.toString().match(str))) {
                return k;
            }
        }
        return null;
    }

    async function addFileProgress(download, progress) {
        if (activeDownloads.has(await downloadId(download))) {
            activeDownloads.set(await downloadId(download), activeDownloads.get(await downloadId(download)) + progress);
        } else {
            activeDownloads.set(await downloadId(download), progress);
        }

        Dispatcher.dispatch({
            type: 'SLF_UPDATE_PROGRESS'
        });
    }

    const concatTypedArrays = (a, b) => { // a, b TypedArray of same type
        var c = new (a.constructor)(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c;
    }

    const isSetLinear = set => {
        for (let setIndex = 0; setIndex < set.length; setIndex++) {
            if (!set.has(setIndex)) {
                return false;
            }
        }
        return true;
    }

    function downloadFiles(download) {
        const https = require("https");
        const fs = require("fs");
        const path = require("path");
        const vals = new Uint8Array(16);
        crypto.getRandomValues(vals);
        const id = Buffer.from(vals).toString("hex");
        const tempFolder = path.join(process.env.TMPDIR, `dlfc-download-${id}`);
        fs.mkdirSync(tempFolder);

        BdApi.showToast("Downloading files...", {type: "info"});

        let promises = [];
        for (const url of download.urls) {
            const chunkName = url.slice(url.lastIndexOf("/") + 1);
            const dest = path.join(tempFolder, chunkName);
            const file = fs.createWriteStream(dest);
            const downloadPromise = new Promise((resolve, reject) => {
                https.get(url, response => {
                    // response.pipe(file);
                    response.on("end", () => {
                        file.close();
                        resolve(chunkName);
                    })
                    response.on('data', data => {
                        file.write(Buffer.from(data));
                        addFileProgress(download, data.length);
                    })
                }).on("error", err => {
                    fs.unlink(dest);
                    reject(err);
                });
            });

            promises.push(downloadPromise);
        }

        Promise.all(promises).then(names => {
            // Load files into array
            let fileBuffers = [];
            for (const name of names) {
                fileBuffers.push(fs.readFileSync(path.join(tempFolder, name), null));
            }

            // Sort buffers
            fileBuffers = fileBuffers.filter(buffer => buffer.length >= 5 && buffer[0] === 0xDF && buffer[1] === 0);
            fileBuffers.sort((left, right) => left[2] - right[2]);

            // Check that all buffers have a correct header and that each chunk is less than the max number and appears only once
            let numChunks = 0;
            let chunkSet = new Set();
            let outputFile = fs.createWriteStream(path.join(tempFolder, `${download.filename}`));
            for (const buffer of fileBuffers) {
                if (buffer[2] >= buffer[3] || (numChunks !== 0 && buffer[3] > numChunks)) {
                    BdApi.showToast("Reassembly failed: Some chunks are not part of the same file", {type: "error"});
                    outputFile.close();
                    return;
                }
                chunkSet.add(buffer[2]);
                numChunks = buffer[3];
                outputFile.write(buffer.subarray(4));
            }
            // Go through chunk set one by one to make sure that the values are contiguous
            if (!isSetLinear(chunkSet) || chunkSet.size === 0) {
                BdApi.showToast("Reassembly failed: Some chunks do not exist", {type: "error"});
                outputFile.close();
                return;
            }
            outputFile.close(() => {
                // Save file to valid directory and open it if required
                BdApi.showToast("File reassembled successfully", {type: "success"});

                DiscordNative.fileManager.saveWithDialog(fs.readFileSync(path.join(tempFolder, `${download.filename}`)), download.filename);

                downloadId(download).then(id => activeDownloads.delete(id));

                Dispatcher.dispatch({
                    type: 'SLF_UPDATE_PROGRESS'
                });

                // Clean up
                fs.rmdirSync(tempFolder, {recursive: true});
            });
        })
        .catch(err => {
            Logger.error(err);
            BdApi.showToast("Failed to download file, please try again later.", {type: "error"});
            fs.rmdirSync(tempFolder, {recursive: true});
        })
    }

    function FileIcon() {
        return React.createElement("img", {
            className: "dlfcIcon",
            alt: "Attachment file type: SplitLargeFiles Chunk File",
            title: "SplitLargeFiles Chunk File",
            src: "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+Cjxzdmcgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgdmlld0JveD0iMCAwIDcyIDk2IiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHhtbDpzcGFjZT0icHJlc2VydmUiIHhtbG5zOnNlcmlmPSJodHRwOi8vd3d3LnNlcmlmLmNvbS8iIHN0eWxlPSJmaWxsLXJ1bGU6ZXZlbm9kZDtjbGlwLXJ1bGU6ZXZlbm9kZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLW1pdGVybGltaXQ6MjsiPgogICAgPHBhdGggZD0iTTcyLDI5LjNMNzIsODkuNkM3Miw5MS44NCA3Miw5Mi45NiA3MS41Niw5My44MkM3MS4xOCw5NC41NiA3MC41Niw5NS4xOCA2OS44Miw5NS41NkM2OC45Niw5NiA2Ny44NCw5NiA2NS42LDk2TDYuNCw5NkM0LjE2LDk2IDMuMDQsOTYgMi4xOCw5NS41NkMxLjQ0LDk1LjE4IDAuODIsOTQuNTYgMC40NCw5My44MkMwLDkyLjk2IDAsOTEuODQgMCw4OS42TDAsNi40QzAsNC4xNiAwLDMuMDQgMC40NCwyLjE4QzAuODIsMS40NCAxLjQ0LDAuODIgMi4xOCwwLjQ0QzMuMDQsLTAgNC4xNiwtMCA2LjQsLTBMNDIuNywtMEM0NC42NiwtMCA0NS42NCwtMCA0Ni41NiwwLjIyQzQ3LjA2LDAuMzQgNDcuNTQsMC41IDQ4LDAuNzJMNDgsMTcuNkM0OCwxOS44NCA0OCwyMC45NiA0OC40NCwyMS44MkM0OC44MiwyMi41NiA0OS40NCwyMy4xOCA1MC4xOCwyMy41NkM1MS4wNCwyNCA1Mi4xNiwyNCA1NC40LDI0TDcxLjI4LDI0QzcxLjUsMjQuNDYgNzEuNjYsMjQuOTQgNzEuNzgsMjUuNDRDNzIsMjYuMzYgNzIsMjcuMzQgNzIsMjkuM1oiIHN0eWxlPSJmaWxsOnJnYigyMTEsMjE0LDI1Myk7ZmlsbC1ydWxlOm5vbnplcm87Ii8+CiAgICA8cGF0aCBkPSJNNjguMjYsMjAuMjZDNjkuNjQsMjEuNjQgNzAuMzIsMjIuMzIgNzAuODIsMjMuMTRDNzEsMjMuNDIgNzEuMTQsMjMuNyA3MS4yOCwyNEw1NC40LDI0QzUyLjE2LDI0IDUxLjA0LDI0IDUwLjE4LDIzLjU2QzQ5LjQ0LDIzLjE4IDQ4LjgyLDIyLjU2IDQ4LjQ0LDIxLjgyQzQ4LDIwLjk2IDQ4LDE5Ljg0IDQ4LDE3LjZMNDgsMC43MkM0OC4zLDAuODYgNDguNTgsMSA0OC44NiwxLjE4QzQ5LjY4LDEuNjggNTAuMzYsMi4zNiA1MS43NCwzLjc0TDY4LjI2LDIwLjI2WiIgc3R5bGU9ImZpbGw6cmdiKDE0NywxNTUsMjQ5KTtmaWxsLXJ1bGU6bm9uemVybzsiLz4KICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDEsNC41LDcpIj4KICAgICAgICA8cmVjdCB4PSIxMSIgeT0iNDEiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyOCIgc3R5bGU9ImZpbGw6cmdiKDE0NywxNTUsMjQ5KTsiLz4KICAgIDwvZz4KICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDAuNSwtMiwyMy41KSI+CiAgICAgICAgPHJlY3QgeD0iMjEiIHk9IjM5IiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIHN0eWxlPSJmaWxsOnJnYigxNDcsMTU1LDI0OSk7Ii8+CiAgICA8L2c+CiAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwwLjUsMjIsMjMuNSkiPgogICAgICAgIDxyZWN0IHg9IjIxIiB5PSIzOSIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBzdHlsZT0iZmlsbDpyZ2IoMTQ3LDE1NSwyNDkpOyIvPgogICAgPC9nPgo8L3N2Zz4K"
        });
    }

    class AttachmentShim extends React.Component {
        constructor(props) {
            super(props);

            this.child = props.children;
            this.attachmentID = props.attachmentData.id;

            this.state = {
                downloadData: null,
                downloadProgress: 0
            }

            this.onNewDownload = this.onNewDownload.bind(this);
            this.onDownloadProgress = this.onDownloadProgress.bind(this);
        }

        componentDidMount() {
            Dispatcher.subscribe("DLFC_REFRESH_DOWNLOADS", this.onNewDownload);
            Dispatcher.subscribe('SLF_UPDATE_PROGRESS', this.onDownloadProgress);
        }

        componentWillUnmount() {
            Dispatcher.unsubscribe("DLFC_REFRESH_DOWNLOADS", this.onNewDownload);
            Dispatcher.unsubscribe('SLF_UPDATE_PROGRESS', this.onDownloadProgress);
        }

        onNewDownload(e) {
            // Don't do anything if full download data already received
            if (this.state.downloadData) { return; }

            for (const download of e.downloads) {
                if (download.messages[0].attachmentID === this.attachmentID) {
                    this.setState({downloadData: download});
                    break;
                }
            }
        }

        onDownloadProgress() {
            downloadId(this.state.downloadData).then(id => {
                if (this.state.downloadData && activeDownloads.has(id)) {
                    this.setState({downloadProgress: activeDownloads.get(id) / this.state.downloadData.totalSize});
                } else {
                    this.setState({downloadProgress: 0});
                }
            });
        }

        render() {
            if (this.state.downloadData) {
                return React.createElement(Attachment[getFunctionNameFromString(Attachment, ["renderAdjacentContent"])], {
                    filename: this.state.downloadData.filename + (this.state.downloadProgress > 0 ? ` - Downloading ${Math.round(this.state.downloadProgress * 100)}%` : ""),
                    url: null,
                    dlfc: true,
                    size: this.state.downloadData.totalSize,
                    onClick: () => { downloadFiles(this.state.downloadData); }
                }, []);
            } else {
                return this.child;
            }
        }
    }

    const defaultSettingsData = {
        deletionDelay: 9
    };
    let settings = null;

    const reloadSettings = () => {
        settings = PluginUtilities.loadSettings("SplitLargeFiles", defaultSettingsData);
    };

    // Default values for how long to wait to delete or upload a chunk file
    // Values should be around the time a normal user would take to delete or upload each file
    const validActionDelays = [6, 7, 8, 9, 10, 11, 12];

    class SplitLargeFiles extends Plugin {
        onStart() {
            BdApi.injectCSS("SplitLargeFiles", `
                .dlfcIcon {
                    width: 30px;
                    height: 40px;
                    margin-right: 8px;
                }

                .slfClickable {
                    cursor: pointer;
                    background: none;
                }
                .slfIcon {
                    color: var(--interactive-normal);
                }
                .slfClickable:hover .slfIcon {
                    color: var(--interactive-hover);
                }
            `);

            // Load settings data
            reloadSettings();

            this.registeredDownloads = [];
            this.incompleteDownloads = [];

            /**
             * UPLOAD MODULE
             */

            Patcher.instead(MessageAttachmentManager, "addFiles", (_, [{files, channelId}], original) => {
                let oversizedFiles = [], regularFiles = [];
                for (const fileContainer of files) {
                    // Calculate chunks required
                    const [numChunks, numChunksWithHeaders] = this.calcNumChunks(fileContainer.file);
                    // Don't do anything if no changes needed
                    if (numChunks === 1) {
                        // File is regular, add to regular list
                        regularFiles.push(fileContainer);
                        continue;
                    } else if (numChunksWithHeaders > 255) { // Check to make sure the number of files when chunked with header is not greater than 255 otherwise fail
                        BdApi.showToast("File size exceeds max chunk count of 255.", {type: "error"});
                        return;
                    }

                    // File is oversized, add it to oversized list
                    oversizedFiles.push(fileContainer);
                }

                if (oversizedFiles.length === 0) {
                    original({
                        files: regularFiles,
                        channelId: channelId,
                        showLargeMessageDialog: false,
                        draftType: 0
                    });
                } else {
                    this.splitLargeFiles(oversizedFiles).then(fileArrayArray => {
                        if (fileArrayArray.length === 0) {
                            return;
                        }

                        const fileArray = regularFiles.concat.apply([], fileArrayArray);

                        if (queuedUploads.has(channelId)) {
                            queuedUploads.get(channelId).push(fileArray);
                        } else {
                            queuedUploads.set(channelId, fileArray);
                        }

                        original({
                            files: queuedUploads.get(channelId).splice(0, BATCH_SIZE),
                            channelId: channelId,
                            showLargeMessageDialog: false,
                            draftType: 0
                        });
                    });
                }
            });

            // Inject flag argument so that this plugin can still get real max size for chunking but anything else gets a really big number
//            Patcher.instead(FileCheckMod, getFunctionNameFromString(FileCheckMod, ["getUserMaxFileSize", "getCurrentUser();"]), (_, args, original) => {
//                // Must be unwrapped this way otherwise errors occur with undefined unwrapping
//                Logger.log("using patched function")
//                const [arg, use_original] = args;
//                if (use_original) {
//                    Logger.log("using original function")
//                    return original(arg);
//                }
//                return Integer.MAX_SAFE_NUMBER;
//            });

            // Make sure all files pass size check
            Patcher.instead(FileCheckMod, getFunctionNameFromString(FileCheckMod, [/Array\.from\(.\)\.some\(\(function\(.\)/]), (_, __, ___) => false);

            Patcher.after(MessageAccessories.prototype, "renderAttachments", (_, [arg], ret) => {
                if (!ret || arg.attachments.length === 0 || !arg.attachments[0].filename.endsWith(".dlfc")) { return; }

                const component = ret[0].props.children;
                ret[0].props.children = (
                    <AttachmentShim attachmentData={arg.attachments[0]}>
                        {component}
                    </AttachmentShim>
                );
            });

            // Adds onClick to download arrow button that for some reason doesn't have it already
            Patcher.after(Attachment, getFunctionNameFromString(Attachment, ["renderAdjacentContent"]), (_, args, ret) => {
                ret.props.children[0].props.children[2].props.onClick = args[0].onClick;
                if (args[0].dlfc) {
                    ret.props.children[0].props.children[0] = <FileIcon/>;
                }
            });

            /**
             * RENDER MODULE
             */

            this.messageCreate = e => {
                // Disregard if not in same channel or in process of being sent
                if (e.channelId === this.getCurrentChannel()?.id) {
                    // Check if there are still chunks in the queue
                    if (queuedUploads.has(e.channelId) && e.message.author.id === UserStore.getCurrentUser().id) {
                        MessageAttachmentManager.addFiles({
                            files: queuedUploads.get(e.channelId).splice(0, BATCH_SIZE),
                            channelId: e.channelId
                        });

                        if (queuedUploads.get(e.channelId).length === 0) {
                            queuedUploads.delete(e.channelId);
                        }
                    }

                    setTimeout(() => this.findAvailableDownloads(), 500);
                }
            };

            Dispatcher.subscribe("MESSAGE_CREATE", this.messageCreate);

            this.channelSelect = _ => {
                // Wait a bit to allow DOM to update before refreshing
                setTimeout(() => this.findAvailableDownloads(), 200);
            };

            Dispatcher.subscribe("CHANNEL_SELECT", this.channelSelect);

            // Adds some redundancy for slow network connections
            this.loadMessagesSuccess = _ => {
                this.findAvailableDownloads();
            };

            Dispatcher.subscribe("LOAD_MESSAGES_SUCCESS", this.loadMessagesSuccess);

            // Manual refresh button in both channel and message menus
            this.messageContextMenuUnpatch = ContextMenu.patch("message", (tree, props) => {
                const incomplete = this.incompleteDownloads.find(download => download.messages.some(message => message.id === props.message.id));
                if (!(incomplete || this.registeredDownloads.find(download => download.messages.some(msg => msg.id === props.message.id)))) {
                    return;
                }

                tree.props.children[2].props.children.push(
                    ContextMenu.buildItem({type: "separator"}),
                    ContextMenu.buildItem({label: "Refresh Downloadables", action: () => {
                        this.findAvailableDownloads();
                        BdApi.showToast("Downloadables refreshed", {type: "success"});
                    }}),
                    ContextMenu.buildItem({label: "Copy Download Links", action: () => {
                        const urls = this.getFileURLsFromMessageId(props.message.id);
                        if (!urls) {
                            BdApi.showToast("Failed to Copy Links", {type: "error"});
                        }
                        DiscordNative.clipboard.copy(urls.join(" "));
                    }})
                );

                if (incomplete && this.canDeleteDownload(incomplete)) {
                    tree.props.children[2].props.children.push(
                        ContextMenu.buildItem({label: "Delete Download Fragments", danger: true, action: () => {
                            this.deleteDownload(incomplete);
                            this.findAvailableDownloads();
                        }})
                    );
                }
            });

            this.channelContextMenuUnpatch = ContextMenu.patch("channel-context", (tree, _) => {
                tree.props.children[2].props.children.push(
                    ContextMenu.buildItem({type: "separator"}),
                    ContextMenu.buildItem({label: "Refresh Downloadables", action: () => {
                        this.findAvailableDownloads();
                        BdApi.showToast("Downloadables refreshed", {type: "success"});
                    }})
                );
            });

            this.userContextMenuUnpatch = ContextMenu.patch("user-context", (tree, _) => {
                tree.props.children[2].props.children.push(
                    ContextMenu.buildItem({type: "separator"}),
                    ContextMenu.buildItem({label: "Refresh Downloadables", action: () => {
                        this.findAvailableDownloads();
                        BdApi.showToast("Downloadables refreshed", {type: "success"});
                    }})
                );
            })

            // Handle deletion of part of file to delete all other parts either by user or automod
            this.messageDelete = e => {
                // Disregard if not in same channel
                if (e.channelId !== this.getCurrentChannel()?.id) {
                    return;
                }
                const download = this.registeredDownloads.find(element => element.messages.find(message => message.id === e.id));
                if (download && this.canDeleteDownload(download)) {
                    this.deleteDownload(download, e.id);
                }
                this.findAvailableDownloads();
            }

            Dispatcher.subscribe("MESSAGE_DELETE", this.messageDelete);

            /**
             * COMPLETION
             */

            BdApi.showToast("Waiting for BetterDiscord to load before refreshing downloadables...", {type: "info"});
            // Wait for DOM to render before trying to find downloads
            setTimeout(() => {
                BdApi.showToast("Downloadables refreshed", {type: "success"});
                this.findAvailableDownloads()
            }, 10000);
        }

        // Gets the required links to copy a downloadable
        getFileURLsFromMessageId(messageId) {
            const download = this.registeredDownloads.find(download => download.messages.some(msg => msg.id === messageId));
            return download?.urls;
        }

        // Splits and uploads a large file
        // Batch uploading should be disabled when multiple files need to be uploaded to prevent API spam
        splitLargeFiles(fileContainers) {
            BdApi.showToast("Generating file chunks...", {type: "info"});

            let promises = [];
            for (const fileContainer of fileContainers) {
                const file = fileContainer.file;
                // Convert file to bytes
                promises.push(new Promise((res, rej) => {
                    file.arrayBuffer().then(buffer => {
                        const fileBytes = new Uint8Array(buffer);

                        // Calculate chunks required
                        const [numChunks, numChunksWithHeaders] = this.calcNumChunks(file);

                        // Write files with leading bit to determine order
                        // Upload new chunked files
                        const fileList = [];
                        for (let chunk = 0; chunk < numChunksWithHeaders; chunk++) {
                            // Get an offset with size
                            const baseOffset = chunk * (this.maxFileUploadSize() - 4);
                            // Write header: "DF" (discord file) then protocol version then chunk number then total chunk count
                            const headerBytes = new Uint8Array(4);
                            headerBytes.set([0xDF, 0x00, chunk & 0xFF, numChunks & 0xFF]);
                            // Slice original file with room for header
                            const bytesToWrite = fileBytes.slice(baseOffset, baseOffset + this.maxFileUploadSize() - 4);
                            // Add file to array
                            fileList.push({
                                file: new File([concatTypedArrays(headerBytes, bytesToWrite)], `${chunk}-${numChunks - 1}_${file.name}.dlfc`),
                                platform: fileContainer.platform
                            });
                        }

                        res(fileList);
                    }).catch(err => {
                        Logger.error(err);
                        BdApi.showToast("Failed to read file, please try again later.", {type: "error"});
                        rej();
                    });
                }));
            }

            return Promise.all(promises)
        }

        // Returns numChunks and numChunksWithHeaders
        calcNumChunks(file) {
            return [Math.ceil(file.size / this.maxFileUploadSize()), Math.ceil(file.size / (this.maxFileUploadSize() - 4))]
        }

        // Create the settings panel
        getSettingsPanel() {
            reloadSettings();
            return new SettingPanel(() => { PluginUtilities.saveSettings("SplitLargeFiles", settings); },
                new Slider("Chunk File Deletion Delay", "How long to wait (in seconds) before deleting each sequential message of a chunk file." +
                    " If you plan on deleting VERY large files you should set this value high to avoid API spam.",
                    validActionDelays[0], validActionDelays[validActionDelays.length - 1], settings.deletionDelay, newVal => {
                        // Make sure value is in bounds
                        if (newVal > validActionDelays[validActionDelays.length - 1] || newVal < validActionDelays[0]) {
                            newVal = validActionDelays[0];
                        }
                        settings.deletionDelay = newVal;
                    }, {markers: validActionDelays, stickToMarkers: true})
            ).getElement();
        }

        // Gets the maximum file upload size for the current server
        maxFileUploadSize() {
            // Built-in buffer, otherwise file upload fails
            return FileCheckMod[getFunctionNameFromString(FileCheckMod, ["getUserMaxFileSize", /getCurrentUser\(\);/])](SelectedGuildStore.getGuildId()) - 1000;
        }

        // Looks through current messages to see which ones have (supposedly) complete .dlfc files and make a list of them
        // We are unable to completely verify the integrity of the files without downloading them and checking their headers
        // Checks messages sequentially and will tag messages at the top that don't have complete downloads available for further warnings
        findAvailableDownloads() {
            this.registeredDownloads = [];
            this.incompleteDownloads = [];

            for (const message of this.getChannelMessages(this.getCurrentChannel()?.id) ?? []) {
                // If object already searched with nothing then skip
                if (message.noDLFC) {
                    continue;
                }

                // Check for DLFC files
                let foundDLFCAttachment = false;
                for (const attachment of message.attachments) {
                    // Make sure file (somewhat) follows correct format, if not then skip
                    if (isNaN(parseInt(attachment.filename)) || !attachment.filename.endsWith(".dlfc")) {
                        continue;
                    }
                    foundDLFCAttachment = true;
                    const realName = this.extractRealFileName(attachment.filename);
                    // Finds the first (latest) entry that has the name that doesn't already have a part of the same index
                    const existingEntry = this.registeredDownloads.find(element => element.filename === realName && !element.foundParts.has(parseInt(attachment.filename)));
                    if (existingEntry) {
                        // Add to existing entry if found
                        existingEntry.urls.push(attachment.url);
                        existingEntry.messages.push({id: message.id, date: message.timestamp, attachmentID: attachment.id});
                        existingEntry.foundParts.add(parseInt(attachment.filename));
                        existingEntry.totalSize += attachment.size;
                    } else {
                        // Create new download
                        this.registeredDownloads.unshift({
                            filename: realName,
                            owner: message.author.id,
                            urls: [attachment.url],
                            messages: [{id: message.id, date: message.timestamp, attachmentID: attachment.id}],
                            foundParts: new Set([parseInt(attachment.filename)]),
                            totalSize: attachment.size
                        });
                    }
                }

                // Tag object if no attachments found to prevent unneeded repeat scans
                if (!foundDLFCAttachment) {
                    message.noDLFC = true;
                }
            }

            // Filter downloads that aren't contiguous
            this.registeredDownloads = this.registeredDownloads.filter((value, _, __) => {
                const chunkSet = new Set();
                let highestChunk = 0;
                for (const url of value.urls) {
                    // Extract file data from URL and add it to check vars
                    const filename = url.slice(url.lastIndexOf("/") + 1);
                    const fileNumber = parseInt(filename);
                    const fileTotal = parseInt(filename.slice(filename.indexOf("-") + 1));
                    chunkSet.add(fileNumber);
                    if (highestChunk === 0) {
                        highestChunk = fileTotal;
                    } else if (highestChunk !== fileTotal) {
                        this.incompleteDownloads.push(value);
                        return false;
                    }
                }

                // Make sure all number parts are present and the highest chunk + 1 is equal to the size (zero indexing)
                const result = isSetLinear(chunkSet) && highestChunk + 1 === chunkSet.size;
                if (!result) {
                    // Add to incomplete download register if failed
                    this.incompleteDownloads.push(value);
                }
                return result;
            });

            // Iterate over remaining downloads and hide all messages except for the one sent first
            this.registeredDownloads.forEach(download => {
                download.messages.sort((first, second) => first.date - second.date);
                // Rename first message to real file name
                // this.formatFirstDownloadMessage(download.messages[0].id, download);

                // Hide the rest of the messages
                for (let messageIndex = 1; messageIndex < download.messages.length; messageIndex++) {
                    // If using multi-upload-per-messages, make sure only attachments are hidden
                    if (download.messages[messageIndex].id === download.messages[0].id) {
                        this.setAttachmentVisibility(download.messages[0].id, messageIndex, false);
                    } else {
                        this.setMessageVisibility(download.messages[messageIndex].id, false);
                    }
                }
            });

            if (this.registeredDownloads.length > 0) {
                Dispatcher.dispatch({
                    type: "DLFC_REFRESH_DOWNLOADS",
                    downloads: this.registeredDownloads
                });
            }
        }

        // Extracts the original file name from the wrapper
        extractRealFileName(name) {
            return name.slice(name.indexOf("_") + 1, name.length - 5);
        }

        // Shows/hides a message with a certain ID
        setMessageVisibility(id, visible) {
            const element = DOMTools.query(`#chat-messages-${id}`);
            if (element) {
                if (visible) {
                    element.removeAttribute("hidden");
                } else {
                    element.setAttribute("hidden", "");
                }
            } else {
                Logger.error(`Unable to find DOM object with selector #chat-messages-${id}`);
            }
        }

        // If index = -1, set all to specified
        setAttachmentVisibility(id, index, visible) {
            const parent = DOMTools.query(`#message-accessories-${id}`);
            const element = parent.children[index];
            if (element) {
                if (visible) {
                    parent.removeAttribute("style");
                    element.removeAttribute("style");
                } else {
                    parent.setAttribute("style", "grid-row-gap: 0;");
                    element.setAttribute("style", "display: none;");
                }
            } else {
                Logger.error(`Unable to find child DOM object at index ${index} with parent selector #message-accessories-${id}`);
            }
        }

        // Deletes a download with a delay to make sure Discord's API isn't spammed
        // Excludes a message that was already deleted
        // Doesn't do anything if all of the download chunks were part of the same message
        deleteDownload(download, excludeMessage = null) {
            // If all downloads in same message, do nothing
            if (download.messages.map(msg => msg.id).every((id, i, arr) => id === arr[0])) {
                return;
            }

            BdApi.showToast(`Deleting chunks (1 chunk/${settings.deletionDelay} seconds)`, {type: "success"});
            let delayCount = 1;
            for (const message of this.getChannelMessages(this.getCurrentChannel().id)) {
                const downloadMessage = download.messages.find(dMessage => dMessage.id === message.id);
                if (downloadMessage) {
                    if (excludeMessage && message.id === excludeMessage.id) {
                        continue;
                    }
                    this.setMessageVisibility(message.id, true);
                    const downloadMessageIndex = download.messages.indexOf(downloadMessage);
                    download.messages.splice(downloadMessageIndex, 1);
                    setTimeout(() => this.deleteMessage(message), delayCount * settings.deletionDelay * 1000);
                    delayCount += 1;
                }
            }
        }

        canDeleteDownload(download) {
            return download.owner === UserStore.getCurrentUser().id || this.canManageMessages();
        }

        getCurrentChannel() {
            return ChannelStore.getChannel(SelectedChannelStore.getChannelId()) ?? null;
        }

        getChannelMessages(channelId) {
            if (!channelId) {
                return null;
            }
            return MessageStore.getMessages(channelId)._array;
        }

        canManageMessages() {
            const currentChannel = this.getCurrentChannel();
            if (!currentChannel) {
                return false;
            }
            // Convert permissions big int into bool using falsy coercion
            return !!(Permissions.computePermissions(currentChannel) & 0x2000n);
        }

        deleteMessage(message) {
            MessageActions.deleteMessage(message.channel_id, message.id, false);
        }

        onStop() {
            Patcher.unpatchAll();
            if (this.messageContextMenuUnpatch) this.messageContextMenuUnpatch();
            if (this.channelContextMenuUnpatch) this.channelContextMenuUnpatch();
            if (this.userContextMenuUnpatch) this.userContextMenuUnpatch();
            Dispatcher.unsubscribe("MESSAGE_CREATE", this.messageCreate);
            Dispatcher.unsubscribe("CHANNEL_SELECT", this.channelSelect);
            Dispatcher.unsubscribe("MESSAGE_DELETE", this.messageDelete);
            Dispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", this.loadMessagesSuccess);
            BdApi.clearCSS("SplitLargeFiles");
        }
    };

    return SplitLargeFiles;
}
