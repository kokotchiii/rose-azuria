// Preload : pour l'instant on n'expose rien (l'app parle direct à Supabase
// depuis le renderer via le SDK JS). On garde le fichier prêt à exposer
// des API natives plus tard (impression, dialog OS, etc.).

import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("api", {
  platform: process.platform,
});
