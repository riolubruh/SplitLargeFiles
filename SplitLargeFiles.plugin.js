/**
 * @name SplitLargeFiles
 * @description Splits files larger than the upload limit into smaller chunks that can be redownloaded into a full file later.
 * @version 1.9.2
 * @author ImTheSquid & Riolubruh
 * @authorId 262055523896131584
 * @website https://github.com/riolubruh/SplitLargeFiles
 * @source https://github.com/riolubruh/SplitLargeFiles
 * @updateUrl https://raw.githubusercontent.com/riolubruh/SplitLargeFiles/main/SplitLargeFiles.plugin.js
 */
/*@cc_on
@if (@_jscript)
    
    // Offer to self-install for clueless users that try to run this directly.
    var shell = WScript.CreateObject("WScript.Shell");
    var fs = new ActiveXObject("Scripting.FileSystemObject");
    var pathPlugins = shell.ExpandEnvironmentStrings("%APPDATA%\\BetterDiscord\\plugins");
    var pathSelf = WScript.ScriptFullName;
    // Put the user at ease by addressing them in the first person
    shell.Popup("It looks like you've mistakenly tried to run me directly. \n(Don't do that!)", 0, "I'm a plugin for BetterDiscord", 0x30);
    if (fs.GetParentFolderName(pathSelf) === fs.GetAbsolutePathName(pathPlugins)) {
        shell.Popup("I'm in the correct folder already.", 0, "I'm already installed", 0x40);
    } else if (!fs.FolderExists(pathPlugins)) {
        shell.Popup("I can't find the BetterDiscord plugins folder.\nAre you sure it's even installed?", 0, "Can't install myself", 0x10);
    } else if (shell.Popup("Should I copy myself to BetterDiscord's plugins folder for you?", 0, "Do you need some help?", 0x34) === 6) {
        fs.CopyFile(pathSelf, fs.BuildPath(pathPlugins, fs.GetFileName(pathSelf)), true);
        // Show the user where to put plugins in the future
        shell.Exec("explorer " + pathPlugins);
        shell.Popup("I'm installed!", 0, "Successfully installed", 0x40);
    }
    WScript.Quit();

@else@*/
const config = {
    info: {
        name: "SplitLargeFiles",
        authors: [
            {
                name: "ImTheSquid",
                discord_id: "262055523896131584",
                github_username: "ImTheSquid",
                twitter_username: "ImTheSquid11"
            },{
                name: "Riolubruh",
                discord_id: "359063827091816448",
                github_username: "riolubruh",
                twitter_username: "riolubruh"
            }
        ],
        version: "1.9.2",
        description: "Splits files larger than the upload limit into smaller chunks that can be redownloaded into a full file later.",
        github: "https://github.com/riolubruh/SplitLargeFiles",
        github_raw: "https://raw.githubusercontent.com/riolubruh/SplitLargeFiles/main/SplitLargeFiles.plugin.js"
    },
    changelog: [
        {
            title: "Fix shit again",
            items: [
				"Kinda fixed after Discord update that fucked everything up"
            ]
        }
    ],
    main: "bundled.js"
};
class Dummy {
    constructor() {this._config = config;}
    start() {}
    stop() {}
}
 
if (!global.ZeresPluginLibrary) {
    BdApi.showConfirmationModal("Library Missing", `The library plugin needed for ${config.name ?? config.info.name} is missing. Please click Download Now to install it.`, {
        confirmText: "Download Now",
        cancelText: "Cancel",
        onConfirm: () => {
            require("request").get("https://betterdiscord.app/gh-redirect?id=9", async (err, resp, body) => {
                if (err) return require("electron").shell.openExternal("https://betterdiscord.app/Download?id=9");
                if (resp.statusCode === 302) {
                    require("request").get(resp.headers.location, async (error, response, content) => {
                        if (error) return require("electron").shell.openExternal("https://betterdiscord.app/Download?id=9");
                        await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, "0PluginLibrary.plugin.js"), content, r));
                    });
                }
                else {
                    await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, "0PluginLibrary.plugin.js"), body, r));
                }
            });
        }
    });
}
 
module.exports = !global.ZeresPluginLibrary ? Dummy : (([Plugin, Api]) => {
     const plugin = (Plugin, Library) => {
  "use strict";
  const { ContextMenu, Webpack, React } = BdApi;
  const { byProps } = Webpack.Filters;
  const { Logger, Patcher, DiscordModules, DOMTools, PluginUtilities, Settings } = Library;
  const { SettingPanel, Slider } = Settings;
  const { Dispatcher, SelectedChannelStore, SelectedGuildStore, UserStore, MessageStore, Permissions, ChannelStore, MessageActions } = DiscordModules;
  const MessageAttachmentManager = Webpack.getModule(byProps("addFiles"));
  const FileCheckMod = Webpack.getModule((m) => Object.values(m).filter((v) => v?.toString).map((v) => v.toString()).some((v) => v.includes("getCurrentUser();") && v.includes("getUserMaxFileSize")));
  const MessageAccessories = ZLibrary.WebpackModules.getByProps("MessageAccessories").MessageAccessories;
  const Attachment = ZLibrary.WebpackModules.getByProps("isMediaAttachment", "default");
  const BATCH_SIZE = 10;
  const queuedUploads = /* @__PURE__ */ new Map();
  const activeDownloads = /* @__PURE__ */ new Map();
  async function downloadId(download) {
    if (!download)
      return null;
    const encoder = new TextEncoder();
    const digested = await crypto.subtle.digest("SHA-256", encoder.encode(download.urls.join("")));
    return Buffer.from(digested).toString("base64");
  }
  function getFunctionNameFromString(obj, search) {
    for (const [k, v] of Object.entries(obj)) {
      if (search.every((str) => v?.toString().match(str))) {
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
      type: "SLF_UPDATE_PROGRESS"
    });
  }
  const concatTypedArrays = (a, b) => {
    var c = new a.constructor(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
  };
  const isSetLinear = (set) => {
    for (let setIndex = 0; setIndex < set.length; setIndex++) {
      if (!set.has(setIndex)) {
        return false;
      }
    }
    return true;
  };
  async function downloadFiles(download) {
    const https = require("https");
    const fs = require("fs");
    const path = require("path");
	const electron = require("electron");
    const vals = new Uint8Array(8);
    crypto.getRandomValues(vals);
    const id = Buffer.from(vals).toString("hex");
    const tempFolder = path.join(process.env.TMP, `dlfc-download-${id}`);
    fs.mkdirSync(tempFolder);
    BdApi.showToast("Downloading files...", { type: "info" });
    let promises = [];
    for (const url of download.urls) {
      let chunkName = url.slice(url.lastIndexOf("/") + 1);
	  chunkName = chunkName.slice(0, chunkName.indexOf("?"));
      const dest = path.join(tempFolder, chunkName);
      const file = fs.createWriteStream(dest);
      const downloadPromise = new Promise((resolve, reject) => {
        https.get(url, (response) => {
          response.on("end", () => {
            file.close();
            resolve(chunkName);
          });
          response.on("data", (data) => {
            file.write(Buffer.from(data));
            addFileProgress(download, data.length);
          });
        }).on("error", (err) => {
          fs.unlink(dest);
          reject(err);
        });
      });
      promises.push(downloadPromise);
    }
	let movelocation = await BdApi.UI.openDialog({
		mode: "save",
		title: "Save As",
		showOverwriteConfirmation: true,
		defaultPath: process.env.USERPROFILE + "\\Desktop\\" + download.filename
	});
    Promise.all(promises).then((names) => {
      let fileBuffers = [];
      for (let name of names) {
		name = name.slice(0, name.indexOf("?"));
		//console.log(name);
		if(name.endsWith(".dlf")){
			name += "c";
		}
        fileBuffers.push(fs.readFileSync(path.join(tempFolder, name), null));
      }
      fileBuffers = fileBuffers.filter((buffer) => buffer.length >= 5 && buffer[0] === 223 && buffer[1] === 0);
      fileBuffers.sort((left, right) => left[2] - right[2]);
      let numChunks = 0;
      let chunkSet = /* @__PURE__ */ new Set();
      let outputFile = fs.createWriteStream(path.join(tempFolder, `${download.filename}`));
      for (const buffer of fileBuffers) {
        if (buffer[2] >= buffer[3] || numChunks !== 0 && buffer[3] > numChunks) {
          BdApi.showToast("Reassembly failed: Some chunks are not part of the same file", { type: "error" });
          outputFile.close();
          return;
        }
        chunkSet.add(buffer[2]);
        numChunks = buffer[3];
        outputFile.write(buffer.subarray(4));
      }
      if (!isSetLinear(chunkSet) || chunkSet.size === 0) {
        BdApi.showToast("Reassembly failed: Some chunks do not exist", { type: "error" });
        outputFile.close();
        return;
      }
      outputFile.close(() => {
        BdApi.showToast("File reassembled successfully", { type: "success" });
		fs.readdirSync(tempFolder).forEach(file => {
			if(file.toString().includes(".dlfc")){
				fs.unlinkSync((tempFolder + "\\" + file.toString()));
			}
		});
		
		//console.log(movelocation);
		//Move the downloaded file to movelocation
		fs.rename((path.join(tempFolder, `${download.filename}`)), movelocation.filePath);
		//electron.shell.showItemInFolder(path.join(tempFolder, `${download.filename}`));
		BdApi.showToast(("File downloaded to " + (path.join(tempFolder, `${download.filename}`))), { type: "success", timeout: 5000 });
		downloadId(download).then((id2) => activeDownloads.delete(id2));
        Dispatcher.dispatch({
          type: "SLF_UPDATE_PROGRESS"
        });
        fs.rmdirSync(tempFolder, { recursive: true });
      });
    }).catch((err) => {
      Logger.error(err);
      BdApi.showToast("Failed to download file, please try again later.", { type: "error" });
      fs.rmdirSync(tempFolder, { recursive: true });
    });
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
      };
      this.onNewDownload = this.onNewDownload.bind(this);
      this.onDownloadProgress = this.onDownloadProgress.bind(this);
    }
    componentDidMount() {
      Dispatcher.subscribe("DLFC_REFRESH_DOWNLOADS", this.onNewDownload);
      Dispatcher.subscribe("SLF_UPDATE_PROGRESS", this.onDownloadProgress);
    }
    componentWillUnmount() {
      Dispatcher.unsubscribe("DLFC_REFRESH_DOWNLOADS", this.onNewDownload);
      Dispatcher.unsubscribe("SLF_UPDATE_PROGRESS", this.onDownloadProgress);
    }
    onNewDownload(e) {
      if (this.state.downloadData) {
        return;
      }
      for (const download of e.downloads) {
        if (download.messages[0].attachmentID === this.attachmentID) {
          this.setState({ downloadData: download });
          break;
        }
      }
    }
    onDownloadProgress() {
      downloadId(this.state.downloadData).then((id) => {
        if (this.state.downloadData && activeDownloads.has(id)) {
          this.setState({ downloadProgress: activeDownloads.get(id) / this.state.downloadData.totalSize });
        } else {
          this.setState({ downloadProgress: 0 });
        }
      });
    }
    render() {
	  //console.log("render called");
      if (this.state.downloadData) {
        return React.createElement(Attachment[getFunctionNameFromString(Attachment, ["renderAdjacentContent"])], {
          filename: this.state.downloadData.filename + (this.state.downloadProgress > 0 ? ` - Downloading ${Math.round(this.state.downloadProgress * 100)}%` : ""),
          url: null,
          dlfc: true,
          size: this.state.downloadData.totalSize,
          onClick: () => {
            downloadFiles(this.state.downloadData);
          }
        }, []);
      } else {
        return this.child;
      }
    }
  }
  const defaultSettingsData = {
    deletionDelay: 9,
	fileSplitSize: 26214400
  };
  let settings = null;
  const reloadSettings = () => {
    settings = PluginUtilities.loadSettings("SplitLargeFiles", defaultSettingsData);
  };
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
	  
	  const uploadinator = ZLibrary.WebpackModules.getByProps("G", "d")
	  BdApi.Patcher.instead("SplitLargeFiles", uploadinator, "d", (_, e) => {
		  try{
			  //console.log(e);
			  var E = Array.from(e[0]).map((function(e) {
				  return {
					file: e,
					platform: 1
				  }
		      }))
		  ZLibrary.WebpackModules.getByProps("addFiles").addFiles({
			  files: E,
			  channelId: e[1].id,
			  showLargeMessageDialog: false,
			  draftType: e[2]
		  })
	  }catch(err){
		  console.error(err);
		  ZLibrary.Toasts.error("An error occurred.")
	  }
	  });
	  
      reloadSettings();
      this.registeredDownloads = [];
      this.incompleteDownloads = [];
      Patcher.instead(MessageAttachmentManager, "addFiles", (_, [{ files, channelId }], original) => {
        let oversizedFiles = [], regularFiles = [];
        for (const fileContainer of files) {
          const [numChunks, numChunksWithHeaders] = this.calcNumChunks(fileContainer.file);
          if (numChunks === 1) {
            regularFiles.push(fileContainer);
            continue;
          } else if (numChunksWithHeaders > 255) {
            BdApi.showToast("File size exceeds max chunk count of 255.", { type: "error" });
            return;
          }
          oversizedFiles.push(fileContainer);
        }
        if (oversizedFiles.length === 0) {
          original({
            files: regularFiles,
            channelId,
            showLargeMessageDialog: false,
            draftType: 0
          });
        } else {
          this.splitLargeFiles(oversizedFiles).then((fileArrayArray) => {
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
              channelId,
              showLargeMessageDialog: false,
              draftType: 0
            });
          });
        }
      });
      Patcher.instead(FileCheckMod, "anyFileTooLarge", () => false);
      Patcher.after(MessageAccessories.prototype, "renderAttachments", (_, [arg], ret) => {
        if (!ret || arg.attachments.length === 0 || !arg.attachments[0].filename.endsWith(".dlfc")) {
          return;
        }
		const component = ret.props.children;
		
		ret.props.children = React.createElement(AttachmentShim, {
		  attachmentData: arg.attachments[0]
		}, component);
      });
      Patcher.after(Attachment, getFunctionNameFromString(Attachment, ["renderAdjacentContent"]), (_, args, ret) => {
        ret.props.children[0].props.children[1].props.onClick = args[0].onClick;
        if (args[0].filename.endsWith(".dlfc")) {
          ret.props.children[0].props.children[0] = /* @__PURE__ */ React.createElement(FileIcon, null);
        }
      });
      this.messageCreate = (e) => {
        if (e.channelId === this.getCurrentChannel()?.id) {
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
      this.channelSelect = (_) => {
        setTimeout(() => this.findAvailableDownloads(), 200);
      };
      Dispatcher.subscribe("CHANNEL_SELECT", this.channelSelect);
      this.loadMessagesSuccess = (_) => {
        this.findAvailableDownloads();
      };
      Dispatcher.subscribe("LOAD_MESSAGES_SUCCESS", this.loadMessagesSuccess);
      this.messageContextMenuUnpatch = ContextMenu.patch("message", (tree, props) => {
        const incomplete = this.incompleteDownloads.find((download) => download.messages.some((message) => message.id === props.message.id));
        const registered = this.registeredDownloads.find((download) => download.messages.some((msg) => msg.id === props.message.id));
        if (!(incomplete || registered)) {
			return;
        }
        tree.props.children[2].props.children.push(ContextMenu.buildItem({ type: "separator" }), ContextMenu.buildItem({ label: "Refresh Downloadables", action: () => {
          this.findAvailableDownloads();
          BdApi.showToast("Downloadables refreshed", { type: "success" });
        } }), ContextMenu.buildItem({ label: "Copy Download Links", action: () => {
          const urls = this.getFileURLsFromMessageId(props.message.id);
          if (!urls) {
            BdApi.showToast("Failed to Copy Links", { type: "error" });
          }
          DiscordNative.clipboard.copy(urls.join(" "));
        } }));
        if (incomplete && this.canDeleteDownload(incomplete)) {
          tree.props.children[2].props.children.push(ContextMenu.buildItem({ label: "Delete Download Fragments", danger: true, action: () => {
            this.deleteDownload(incomplete);
            this.findAvailableDownloads();
          } }));
        }
		if (!incomplete) {
          tree.props.children[2].props.children.push(ContextMenu.buildItem({ label: "Download Large File", action: () => {
            downloadFiles(registered);
          } }));
        }
      });
      this.channelContextMenuUnpatch = ContextMenu.patch("channel-context", (tree, _) => {
        tree.props.children[2].props.children.push(ContextMenu.buildItem({ type: "separator" }), ContextMenu.buildItem({ label: "Refresh Downloadables", action: () => {
          this.findAvailableDownloads();
          BdApi.showToast("Downloadables refreshed", { type: "success" });
        } }));
      });
      this.userContextMenuUnpatch = ContextMenu.patch("user-context", (tree, _) => {
        tree.props.children[2].props.children.push(ContextMenu.buildItem({ type: "separator" }), ContextMenu.buildItem({ label: "Refresh Downloadables", action: () => {
          this.findAvailableDownloads();
          BdApi.showToast("Downloadables refreshed", { type: "success" });
        } }));
      });
      this.messageDelete = (e) => {
        if (e.channelId !== this.getCurrentChannel()?.id) {
          return;
        }
        const download = this.registeredDownloads.find((element) => element.messages.find((message) => message.id === e.id));
        if (download && this.canDeleteDownload(download)) {
          this.deleteDownload(download, e.id);
        }
        this.findAvailableDownloads();
      };
      Dispatcher.subscribe("MESSAGE_DELETE", this.messageDelete);
	  BdApi.Patcher.before("SplitLargeFiles", ZLibrary.WebpackModules.getByProps("Url", "resolve", "resolveObject"), "parse", (_,a) => {
		//Fix crashing issue
		a[0] = String(a[0]);
	  });
      BdApi.showToast("Waiting for BetterDiscord to load before refreshing downloadables...", { type: "info" });
      setTimeout(() => {
        BdApi.showToast("Downloadables refreshed", { type: "success" });
        this.findAvailableDownloads();
      }, 1e4);
    }
    getFileURLsFromMessageId(messageId) {
      const download = this.registeredDownloads.find((download2) => download2.messages.some((msg) => msg.id === messageId));
      return download?.urls;
    }
    splitLargeFiles(fileContainers) {
      BdApi.showToast("Generating file chunks...", { type: "info" });
      let promises = [];
      for (const fileContainer of fileContainers) {
        const file = fileContainer.file;
        promises.push(new Promise((res, rej) => {
          file.arrayBuffer().then((buffer) => {
            const fileBytes = new Uint8Array(buffer);
            const [numChunks, numChunksWithHeaders] = this.calcNumChunks(file);
            const fileList = [];
            for (let chunk = 0; chunk < numChunksWithHeaders; chunk++) {
              const baseOffset = chunk * (this.maxFileUploadSize() - 4);
              const headerBytes = new Uint8Array(4);
              headerBytes.set([223, 0, chunk & 255, numChunks & 255]);
              const bytesToWrite = fileBytes.slice(baseOffset, baseOffset + this.maxFileUploadSize() - 4);
              fileList.push({
                file: new File([concatTypedArrays(headerBytes, bytesToWrite)], `${chunk}-${numChunks - 1}_${file.name}.dlfc`),
                platform: fileContainer.platform
              });
            }
            res(fileList);
          }).catch((err) => {
            Logger.error(err);
            BdApi.showToast("Failed to read file, please try again later.", { type: "error" });
            rej();
          });
        }));
      }
      return Promise.all(promises);
    }
    calcNumChunks(file) {
      return [Math.ceil(file.size / this.maxFileUploadSize()), Math.ceil(file.size / (this.maxFileUploadSize() - 4))];
    }
    getSettingsPanel() {
      reloadSettings();
      const settingPanel = new SettingPanel(() => {
        PluginUtilities.saveSettings("SplitLargeFiles", settings);
      }, new Slider("Chunk File Deletion Delay", "How long to wait (in seconds) before deleting each sequential message of a chunk file. If you plan on deleting VERY large files you should set this value high to avoid API spam.", validActionDelays[0], validActionDelays[validActionDelays.length - 1], settings.deletionDelay, (newVal) => {
        if (newVal > validActionDelays[validActionDelays.length - 1] || newVal < validActionDelays[0]) {
          newVal = validActionDelays[0];
        }
        settings.deletionDelay = newVal;
      }, { markers: validActionDelays, stickToMarkers: true }),
		new Settings.Dropdown("File Split Size", "Changes the size of the split files.", settings.fileSplitSize, [
		{label: "8MB", value: 8387608},
		{label: "25MB", value: 26214400},
		{label: "50MB", value: 52428800},
		{label: "100MB", value: 104333312},
		{label: "500MB", value: 524288000}], value => settings.fileSplitSize = value, {searchable: true}
		)
	  ).getElement();
	  settingPanel.style.paddingBottom = "75px"
	  return settingPanel
    }
    maxFileUploadSize() {
      return settings.fileSplitSize
	}
    findAvailableDownloads() {
      this.registeredDownloads = [];
      this.incompleteDownloads = [];
      for (const message of this.getChannelMessages(this.getCurrentChannel()?.id) ?? []) {
        if (message.noDLFC) {
          continue;
        }
        let foundDLFCAttachment = false;
        for (const attachment of message.attachments) {
          if (isNaN(parseInt(attachment.filename)) || !attachment.filename.endsWith(".dlfc")) {
            continue;
          }
          foundDLFCAttachment = true;
          const realName = this.extractRealFileName(attachment.filename);
          const existingEntry = this.registeredDownloads.find((element) => element.filename === realName && !element.foundParts.has(parseInt(attachment.filename)));
          if(existingEntry){
            existingEntry.urls.push(attachment.url);
            existingEntry.messages.push({ id: message.id, date: message.timestamp, attachmentID: attachment.id });
            existingEntry.foundParts.add(parseInt(attachment.filename));
            existingEntry.totalSize += attachment.size;
          }else{
            this.registeredDownloads.unshift({
              filename: realName,
              owner: message.author.id,
              urls: [attachment.url],
              messages: [{ id: message.id, date: message.timestamp, attachmentID: attachment.id }],
              foundParts: /* @__PURE__ */ new Set([parseInt(attachment.filename)]),
              totalSize: attachment.size
            });
          }
        }
        if (!foundDLFCAttachment) {
          message.noDLFC = true;
        }
      }
      this.registeredDownloads = this.registeredDownloads.filter((value, _, __) => {
        const chunkSet = /* @__PURE__ */ new Set();
        let highestChunk = 0;
        for (const url of value.urls) {
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
        const result = isSetLinear(chunkSet) && highestChunk + 1 === chunkSet.size;
        if (!result) {
          this.incompleteDownloads.push(value);
        }
        return result;
      });
      this.registeredDownloads.forEach((download) => {
        download.messages.sort((first, second) => first.date - second.date);
        for (let messageIndex = 1; messageIndex < download.messages.length; messageIndex++) {
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
    extractRealFileName(name) {
      return name.slice(name.indexOf("_") + 1, name.length - 5);
    }
    setMessageVisibility(id, visible) {
      const element = DOMTools.query('#chat-messages-' + BdApi.findModuleByProps("getLastChannelFollowingDestination").getChannelId() + '-' + id);
      if (element) {
        if (visible) {
          element.removeAttribute("hidden");
        } else {
          element.setAttribute("hidden", "");
        }
      } else {
        Logger.warn('Unable to find DOM object with selector #chat-messages-' + BdApi.findModuleByProps("getLastChannelFollowingDestination").getChannelId() + '-' + id);
      }
    }
    setAttachmentVisibility(id, index, visible) {
      const parent = DOMTools.query('#message-accessories-' + id);
      let element = parent?.lastChild?.children[index];
	  
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
    deleteDownload(download, excludeMessage = null) {
      if (download.messages.map((msg) => msg.id).every((id, i, arr) => id === arr[0])) {
        return;
      }
      BdApi.showToast(`Deleting chunks (1 chunk/${settings.deletionDelay} seconds)`, { type: "success" });
      let delayCount = 1;
      for (const message of this.getChannelMessages(this.getCurrentChannel().id)) {
        const downloadMessage = download.messages.find((dMessage) => dMessage.id === message.id);
        if (downloadMessage) {
          if (excludeMessage && message.id === excludeMessage.id) {
            continue;
          }
          this.setMessageVisibility(message.id, true);
          const downloadMessageIndex = download.messages.indexOf(downloadMessage);
          download.messages.splice(downloadMessageIndex, 1);
          setTimeout(() => this.deleteMessage(message), delayCount * settings.deletionDelay * 1e3);
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
      return !!(Permissions.computePermissions(currentChannel) & 0x2000n);
    }
    deleteMessage(message) {
		try{
			MessageActions.deleteMessage(message.channel_id, message.id, false);
		}catch(err){
			console.error(err);
		}
    }
    onStop() {
      Patcher.unpatchAll();
      if (this.messageContextMenuUnpatch)
        this.messageContextMenuUnpatch();
      if (this.channelContextMenuUnpatch)
        this.channelContextMenuUnpatch();
      if (this.userContextMenuUnpatch)
        this.userContextMenuUnpatch();
      Dispatcher.unsubscribe("MESSAGE_CREATE", this.messageCreate);
      Dispatcher.unsubscribe("CHANNEL_SELECT", this.channelSelect);
      Dispatcher.unsubscribe("MESSAGE_DELETE", this.messageDelete);
      Dispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", this.loadMessagesSuccess);
      BdApi.clearCSS("SplitLargeFiles");
    }
  }
  ;
  return SplitLargeFiles;
};
     return plugin(Plugin, Api);
})(global.ZeresPluginLibrary.buildPlugin(config));
/*@end@*/