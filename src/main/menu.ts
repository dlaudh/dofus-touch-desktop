import { app, Menu, MenuItemConstructorOptions } from "electron";
import { openGameWindow } from "./windows";

/** Native menu: the only "UI" — Cmd/Ctrl+N opens another isolated window. */
export function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => openGameWindow() },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  void app; // referenced for clarity; menu roles cover quit/close
}
