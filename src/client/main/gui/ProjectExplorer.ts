import { NetworkManager } from "../../communication/NetworkManager.js";
import { TextPosition } from "../../compiler/lexer/Token.js";
import { File, Module } from "../../compiler/parser/Module.js";
import { ProgramPrinter } from "../../compiler/parser/ProgramPrinter.js";
import { InterpreterState } from "../../interpreter/Interpreter.js";
import { makeEditable, openContextMenu } from "../../tools/HtmlTools.js";
import { Workspace } from "../../workspace/Workspace.js";
import { Main } from "../Main.js";
import { AccordionPanel, Accordion, AccordionElement, AccordionContextMenuItem } from "./Accordion.js";
import { Helper } from "./Helper.js";
import { text } from "express";
import { WorkspaceData, Workspaces, ClassData } from "../../communication/Data.js";
import { TilingSprite } from "pixi.js";
import { dateToString } from "../../tools/StringTools.js";
import { DistributeToStudentsDialog } from "./DistributeToStudentsDialog.js";


export class ProjectExplorer {

    programPointerModule: Module = null;
    programPointerPosition: TextPosition;
    programPointerDecoration: string[] = [];

    accordion: Accordion;
    fileListPanel: AccordionPanel;
    workspaceListPanel: AccordionPanel;

    $homeAction: JQuery<HTMLElement>;
    $synchronizeAction: JQuery<HTMLElement>;

    constructor(private main: Main, private $projectexplorerDiv: JQuery<HTMLElement>) {

    }

    initGUI() {

        this.accordion = new Accordion(this.$projectexplorerDiv);

        this.initFilelistPanel();

        this.initWorkspacelistPanel();

    }

    initFilelistPanel() {

        let that = this;

        this.fileListPanel = new AccordionPanel(this.accordion, "Kein Workspace gewählt", "3",
            "img_add-file-dark", "Neue Datei...", "java", true);

        this.fileListPanel.newElementCallback =

            (accordionElement, successfulNetworkCommunicationCallback) => {

                if (that.main.currentWorkspace == null) {
                    alert('Bitte wählen Sie zuerst einen Workspace aus.');
                    return null;
                }

                let f: File = {
                    name: accordionElement.name,
                    dirty: false,
                    saved: true,
                    text: "",
                    text_before_revision: null,
                    submitted_date: null,
                    student_edited_after_revision: false,
                    version: 1,
                    panelElement: accordionElement,
                    identical_to_repository_version: false
                };
                let m = new Module(f, that.main);
                let modulStore = that.main.currentWorkspace.moduleStore;
                modulStore.putModule(m);
                that.setModuleActive(m);
                that.main.networkManager.sendCreateFile(m, that.main.currentWorkspace, that.main.workspacesOwnerId,
                    (error: string) => {
                        if (error == null) {
                            successfulNetworkCommunicationCallback(m);
                        } else {
                            alert('Der Server ist nicht erreichbar!');

                        }
                    });

            };

        this.fileListPanel.renameCallback =
            (module: Module, newName: string) => {
                newName = newName.substr(0, 80);
                let file = module.file;

                file.name = newName;
                file.saved = false;
                that.main.networkManager.sendUpdates();
                return newName;
            }

        this.fileListPanel.deleteCallback =
            (module: Module, callbackIfSuccessful: () => void) => {
                that.main.networkManager.sendDeleteWorkspaceOrFile("file", module.file.id, (error: string) => {
                    if (error == null) {
                        that.main.currentWorkspace.moduleStore.removeModule(module);
                        callbackIfSuccessful();
                    } else {
                        alert('Der Server ist nicht erreichbar!');

                    }
                });
            }

            this.fileListPanel.contextMenuProvider = (accordionElement: AccordionElement) => {

                let cmiList: AccordionContextMenuItem[] = [];

                if(!(that.main.user.is_teacher || that.main.user.is_admin || that.main.user.is_schooladmin)){
                    let module: Module = <Module>accordionElement.externalElement;
                    let file = module.file;

                    if(file.submitted_date == null){
                        cmiList.push({
                            caption: "Als Hausaufgabe markieren",
                            callback: (element: AccordionElement) => {

                                let file = (<Module>element.externalElement).file;
                                file.submitted_date = dateToString(new Date());
                                file.saved = false;
                                that.main.networkManager.sendUpdates(null, true);
                                that.renderHomeworkButton(file);
                            }
                        });
                    } else {
                        cmiList.push({
                            caption: "Hausaufgabenmarkierung entfernen",
                            callback: (element: AccordionElement) => {
                                
                                let file = (<Module>element.externalElement).file;
                                file.submitted_date = null;
                                file.saved = false;
                                that.main.networkManager.sendUpdates(null, true);
                                that.renderHomeworkButton(file);
                                
                            }
                        });
                    }

                }

                return cmiList;
            }    



        this.fileListPanel.selectCallback =
            (module: Module) => {
                that.setModuleActive(module);
            }


        this.$synchronizeAction = jQuery('<div class="img_open-change jo_button jo_active" style="margin-right: 4px"' +
            ' title="Workspace mit Repository synchronisieren">');
        this.$synchronizeAction.on('mousedown', (e) => {

            this.main.getCurrentWorkspace().synchronizeWithRepository();

            e.stopPropagation();
        })

        this.fileListPanel.addAction(this.$synchronizeAction);
        this.$synchronizeAction.hide();

    }

    renderHomeworkButton(file: File) {
        let $buttonDiv = file?.panelElement?.$htmlFirstLine?.find('.jo_additionalButtonHomework');
        if ($buttonDiv == null) return;

        $buttonDiv.find('.jo_homeworkButton').remove();

        let klass: string = null;
        let title: string = "";
        if(file.submitted_date != null){
            klass = "img_homework";
            title = "Wurde als Hausaufgabe abgegeben: " + file.submitted_date
            if(file.text_before_revision){
                klass = "img_homework-corrected";
                title = "Korrektur liegt vor."
            }
        } 

        if (klass != null) {
            let $homeworkButtonDiv = jQuery(`<div class="jo_homeworkButton ${klass}" title="${title}"></div>`);
            $buttonDiv.prepend($homeworkButtonDiv);
            if(klass.indexOf("jo_active") >= 0){
                $homeworkButtonDiv.on('mousedown', (e) => e.stopPropagation());
                $homeworkButtonDiv.on('click', (e) => {
                    e.stopPropagation();
                    // TODO
                });
            }

        }
    }



    initWorkspacelistPanel() {

        let that = this;

        this.workspaceListPanel = new AccordionPanel(this.accordion, "WORKSPACES", "2",
            "img_add-workspace-dark", "Neuer Workspace...", "workspace", true);

        this.workspaceListPanel.newElementCallback =

            (accordionElement, successfulNetworkCommunicationCallback) => {

                let owner_id: number = that.main.user.id;
                if(that.main.workspacesOwnerId != null){
                    owner_id = that.main.workspacesOwnerId;
                }

                let w: Workspace = new Workspace(accordionElement.name, that.main, owner_id);
                that.main.workspaceList.push(w);

                that.main.networkManager.sendCreateWorkspace(w, that.main.workspacesOwnerId, (error: string) => {
                    if (error == null) {
                        that.fileListPanel.enableNewButton(true);
                        successfulNetworkCommunicationCallback(w);
                        that.setWorkspaceActive(w);
                        w.renderSynchronizeButton(accordionElement);
                    } else {
                        alert('Der Server ist nicht erreichbar!');

                    }
                });
            };

        this.workspaceListPanel.renameCallback =
            (workspace: Workspace, newName: string) => {
                newName = newName.substr(0, 80);
                workspace.name = newName;
                workspace.saved = false;
                that.main.networkManager.sendUpdates();
                return newName;
            }

        this.workspaceListPanel.deleteCallback =
            (workspace: Workspace, successfulNetworkCommunicationCallback: () => void) => {
                that.main.networkManager.sendDeleteWorkspaceOrFile("workspace", workspace.id, (error: string) => {
                    if (error == null) {
                        that.main.removeWorkspace(workspace);
                        that.fileListPanel.enableNewButton(that.main.workspaceList.length > 0);
                        successfulNetworkCommunicationCallback();
                    } else {
                        alert('Der Server ist nicht erreichbar!');

                    }
                });
            }

        this.workspaceListPanel.selectCallback =
            (workspace: Workspace) => {
                that.main.networkManager.sendUpdates(() => {
                    that.setWorkspaceActive(workspace);
                });
            }

        this.$homeAction = jQuery('<div class="img_home-dark jo_button jo_active" style="margin-right: 4px"' +
            ' title="Meine eigenen Workspaces anzeigen">');
        this.$homeAction.on('mousedown', (e) => {

            that.main.networkManager.sendUpdates(() => {
                that.onHomeButtonClicked();
            });

            that.main.bottomDiv.hideHomeworkTab();

            e.stopPropagation();
        })

        this.workspaceListPanel.addAction(this.$homeAction);
        this.$homeAction.hide();

        this.workspaceListPanel.contextMenuProvider = (workspaceAccordionElement: AccordionElement) => {

            let cmiList: AccordionContextMenuItem[] = [];

            cmiList.push({
                caption: "Duplizieren",
                callback: (element: AccordionElement) => {
                    this.main.networkManager.sendDuplicateWorkspace(element.externalElement,
                        (error: string, workspaceData) => {
                            if (error == null && workspaceData != null) {
                                let newWorkspace: Workspace = Workspace.restoreFromData(workspaceData, this.main);
                                this.main.workspaceList.push(newWorkspace);
                                newWorkspace.panelElement = {
                                    name: newWorkspace.name,
                                    externalElement: newWorkspace,
                                    iconClass: newWorkspace.repository_id == null ? 'workspace' : 'repository'
                                };

                                this.workspaceListPanel.addElement(newWorkspace.panelElement);
                                this.workspaceListPanel.sortElements();
                            }
                            if (error != null) {
                                alert(error);
                            }
                        })
                }
            });

            if(this.main.user.is_teacher && this.main.teacherExplorer.classPanel.elements.length > 0){
                cmiList.push({
                    caption: "An Klasse austeilen...",
                    callback: (element: AccordionElement) => { },
                    subMenu: this.main.teacherExplorer.classPanel.elements.map((ae) => {
                        return {
                            caption: ae.name,
                            callback: (element: AccordionElement) => {
                                let klasse = <any>ae.externalElement;

                                let workspace: Workspace = element.externalElement;

                                this.main.networkManager.sendDistributeWorkspace(workspace, klasse, null, (error: string) => {
                                    if (error == null) {
                                        let networkManager = this.main.networkManager;
                                        let dt = networkManager.updateFrequencyInSeconds * networkManager.forcedUpdateEvery;
                                        alert("Der Workspace " + workspace.name + " wurde an die Klasse " + klasse.name + " ausgeteilt. Er wird in maximal " + 
                                                      dt + " s bei jedem Schüler ankommen.");
                                    } else {
                                        alert(error);
                                    }
                                });

                            }
                        }
                    })
                },
                {
                    caption: "An einzelne Schüler/innen austeilen...",
                    callback: (element: AccordionElement) => { 
                        let classes: ClassData[] = this.main.teacherExplorer.classPanel.elements.map(ae => ae.externalElement);
                        let workspace: Workspace = element.externalElement;
                        new DistributeToStudentsDialog(classes, workspace, this.main);
                    }
                }
                );
            }

            if (this.main.repositoryOn && this.main.workspacesOwnerId == this.main.user.id) {
                if (workspaceAccordionElement.externalElement.repository_id == null) {
                    cmiList.push({
                        caption: "Repository anlegen...",
                        callback: (element: AccordionElement) => { 
                            let workspace: Workspace = element.externalElement;

                            that.main.repositoryCreateManager.show(workspace);
                },
                        subMenu: null,
                        // [{ n: 0, text: "nur privat sichtbar" }, { n: 1, text: "sichtbar für die Klasse" },
                        // { n: 2, text: "sichtbar für die Schule" }].map((k) => {
                        //     return {
                        //         caption: k.text,
                        //         callback: (element: AccordionElement) => {


                                    // this.main.networkManager.sendCreateRepository(workspace, k.n, (error: string, repository_id?: number) => {
                                    //     if (error == null) {
                                    //         this.workspaceListPanel.setElementClass(element, "repository");
                                    //         workspace.renderSynchronizeButton();
                                    //         this.showRepositoryButtonIfNeeded(workspace);
                                    //     } else {
                                    //         alert(error);
                                    //     }
                                    // });

                        //         }
                        //     }
                        // })
                    });
                } else {
                    cmiList.push({
                        caption: "Mit Repository synchronisieren",
                        callback: (element: AccordionElement) => {
                            let workspace: Workspace = element.externalElement;
                            workspace.synchronizeWithRepository();
                        }
                    });
                    cmiList.push({
                        caption: "Vom Repository loslösen",
                        color: "#ff8080",
                        callback: (element: AccordionElement) => {
                            let workspace: Workspace = element.externalElement;
                            workspace.repository_id = null;
                            workspace.saved = false;
                            this.main.networkManager.sendUpdates(() => {
                                that.workspaceListPanel.setElementClass(element, "workspace");
                                workspace.renderSynchronizeButton(element);
                            }, true);
                        }
                    });
                }
            }

            return cmiList;
        }

    }

    onHomeButtonClicked() {
        this.main.teacherExplorer.restoreOwnWorkspaces();
        this.main.networkManager.updateFrequencyInSeconds = this.main.networkManager.ownUpdateFrequencyInSeconds;
        this.$homeAction.hide();
        this.fileListPanel.enableNewButton(this.main.workspaceList.length > 0);
    }

    renderFiles(workspace: Workspace) {

        let name = workspace == null ? "Kein Workspace vorhanden" : workspace.name;

        this.fileListPanel.setCaption(name);
        this.fileListPanel.clear();

        if (this.main.getCurrentWorkspace() != null) {
            for (let module of this.main.getCurrentWorkspace().moduleStore.getModules(false)) {
                module.file.panelElement = null;
            }
        }

        if (workspace != null) {
            let moduleList: Module[] = [];

            for (let m of workspace.moduleStore.getModules(false)) {
                moduleList.push(m);
            }

            moduleList.sort((a, b) => { return a.file.name > b.file.name ? 1 : a.file.name < b.file.name ? -1 : 0 });

            for (let m of moduleList) {

                m.file.panelElement = {
                    name: m.file.name,
                    externalElement: m
                };

                this.fileListPanel.addElement(m.file.panelElement);
                this.renderHomeworkButton(m.file);
            }

            this.fileListPanel.sortElements();

        }
    }

    renderWorkspaces(workspaceList: Workspace[]) {

        this.fileListPanel.clear();
        this.workspaceListPanel.clear();

        for (let w of workspaceList) {
            w.panelElement = {
                name: w.name,
                externalElement: w,
                iconClass: w.repository_id == null ? 'workspace' : 'repository'
            };

            this.workspaceListPanel.addElement(w.panelElement);

            w.renderSynchronizeButton(w.panelElement);
        }

        this.workspaceListPanel.sortElements();
        this.fileListPanel.enableNewButton(workspaceList.length > 0);



    }

    renderErrorCount(workspace: Workspace, errorCountMap: Map<Module, number>) {
        if (errorCountMap == null) return;
        for (let m of workspace.moduleStore.getModules(false)) {
            let errorCount: number = errorCountMap.get(m);
            let errorCountS: string = ((errorCount == null || errorCount == 0) ? "" : "(" + errorCount + ")");

            this.fileListPanel.setTextAfterFilename(m.file.panelElement, errorCountS, 'jo_errorcount');
        }
    }

    showRepositoryButtonIfNeeded(w: Workspace){
        if(w.repository_id != null && w.owner_id == this.main.user.id){
            this.$synchronizeAction.show();

            if (!this.main.user.settings.helperHistory.repositoryButtonDone) {

                Helper.showHelper("repositoryButton", this.main, this.$synchronizeAction);

            }



        } else {
            this.$synchronizeAction.hide();
        }
    }

    setWorkspaceActive(w: Workspace) {

        this.workspaceListPanel.select(w, false);

        if (this.main.interpreter.state == InterpreterState.running) {
            this.main.interpreter.stop();
        }

        this.main.currentWorkspace = w;
        this.renderFiles(w);

        if (w != null) {
            let nonSystemModules = w.moduleStore.getModules(false);

            if (w.currentlyOpenModule != null) {
                this.setModuleActive(w.currentlyOpenModule);
            } else if (nonSystemModules.length > 0) {
                this.setModuleActive(nonSystemModules[0]);
            } else {
                this.setModuleActive(null);
            }

            for (let m of nonSystemModules) {
                m.file.dirty = true;
            }

            if (nonSystemModules.length == 0 && !this.main.user.settings.helperHistory.newFileHelperDone) {

                Helper.showHelper("newFileHelper", this.main, this.fileListPanel.$captionElement);

            }

            this.showRepositoryButtonIfNeeded(w);

        } else {
            this.setModuleActive(null);
        }


    }

    writeEditorTextToFile() {
        let cem = this.getCurrentlyEditedModule();
        if (cem != null)
            cem.file.text = cem.getProgramTextFromMonacoModel(); // 29.03. this.main.monaco.getValue();
    }


    lastOpenModule: Module = null;
    setModuleActive(m: Module) {

        this.main.bottomDiv.homeworkManager.hideRevision();

        if (this.lastOpenModule != null) {
            this.lastOpenModule.getBreakpointPositionsFromEditor();
            this.lastOpenModule.file.text = this.lastOpenModule.getProgramTextFromMonacoModel(); // this.main.monaco.getValue();
            this.lastOpenModule.editorState = this.main.getMonacoEditor().saveViewState();
        }

        if (m == null) {
            this.main.getMonacoEditor().setModel(monaco.editor.createModel("Keine Datei vorhanden.", "text"));
            this.main.getMonacoEditor().updateOptions({ readOnly: true });
        } else {
            this.main.getMonacoEditor().updateOptions({ readOnly: false });
            this.main.getMonacoEditor().setModel(m.model);
            if(this.main.getBottomDiv() != null) this.main.getBottomDiv().errorManager.showParenthesisWarning(m.bracketError);

            if(m.file.text_before_revision != null){
                this.main.bottomDiv.homeworkManager.showHomeWorkRevisionButton();
            } else {
                this.main.bottomDiv.homeworkManager.hideHomeworkRevisionButton();
            }
        }


    }

    setActiveAfterExternalModelSet(m: Module) {
        this.fileListPanel.select(m, false);

        this.lastOpenModule = m;

        if (m.editorState != null) {
            this.main.editor.dontPushNextCursorMove++;
            this.main.getMonacoEditor().restoreViewState(m.editorState);
            this.main.editor.dontPushNextCursorMove--;
        }

        m.renderBreakpointDecorators();

        this.setCurrentlyEditedModule(m);

        this.showProgramPointer();

        setTimeout(() => {
            if (!this.main.getMonacoEditor().getOptions().get(monaco.editor.EditorOption.readOnly)) {
                this.main.getMonacoEditor().focus();
            }
        }, 300);

    }


    private showProgramPointer() {

        if (this.programPointerModule == this.getCurrentlyEditedModule() && this.getCurrentlyEditedModule() != null) {
            let position = this.programPointerPosition;
            let range = {
                startColumn: position.column, startLineNumber: position.line,
                endColumn: position.column + position.length, endLineNumber: position.line
            };

            this.main.getMonacoEditor().revealRangeInCenterIfOutsideViewport(range);
            this.programPointerDecoration = this.main.getMonacoEditor().deltaDecorations(this.programPointerDecoration, [
                {
                    range: range,
                    options: {
                        className: 'jo_revealProgramPointer', isWholeLine: true,
                        overviewRuler: {
                            color: "#6fd61b",
                            position: monaco.editor.OverviewRulerLane.Center
                        },
                        minimap: {
                            color: "#6fd61b",
                            position: monaco.editor.MinimapPosition.Inline
                        }
                    }
                },
                {
                    range: range,
                    options: { beforeContentClassName: 'jo_revealProgramPointerBefore' }
                }
            ]);

        }
    }

    showProgramPointerPosition(file: File, position: TextPosition) {

        // console statement execution:
        if (file == null) {
            return;
        }

        let module = this.main.currentWorkspace.moduleStore.findModuleByFile(file);
        if (module == null) {
            return;
        }

        this.programPointerModule = module;
        this.programPointerPosition = position;

        if (module != this.getCurrentlyEditedModule()) {
            this.setModuleActive(module);
        } else {
            this.showProgramPointer();
        }

    }

    hideProgramPointerPosition() {
        if (this.getCurrentlyEditedModule() == this.programPointerModule) {
            this.main.getMonacoEditor().deltaDecorations(this.programPointerDecoration, []);
        }
        this.programPointerModule = null;
        this.programPointerDecoration = [];
    }

    getCurrentlyEditedModule(): Module {
        let ws = this.main.currentWorkspace;
        if (ws == null) return null;

        return ws.currentlyOpenModule;
    }

    setCurrentlyEditedModule(m: Module) {
        if (m == null) return;
        let ws = this.main.currentWorkspace;
        if (ws.currentlyOpenModule != m) {
            ws.currentlyOpenModule = m;
            ws.saved = false;
            m.file.dirty = true;
        }
    }

    setExplorerColor(color: string) {
        let caption: string;

        if (color == null) {
            color = "transparent";
            caption = "Meine WORKSPACES";
        } else {
            caption = "Schüler-WORKSPACES";
        }

        this.fileListPanel.$listElement.parent().css('background-color', color);
        this.workspaceListPanel.$listElement.parent().css('background-color', color);

        this.workspaceListPanel.setCaption(caption);
    }

    getNewModule(file: File): Module {
        return new Module(file, this.main);
    }

}