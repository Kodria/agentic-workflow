---
description: Sync Issues As Notion Task
---

Debes usar el MCP de Github para extraer los issues activos de un Proyecto que debe ser proporcionado por el usuario y con el MCP de Notion revisar si la tarea ya esta creada o no. 

Casuisticas
1. La tarea ya esta creada y en estado diferente a "Lista", es un update a la tarea 
2. La tarea ya esta creada y en estado "Lista", no hara nada solo notificara al usuario
3. La tarea NO existe, debera crearla


La BD a usar sera "Gestión de tareas", el usuario debera indicar a cual proyecto esta asociado. Antes de proceder a crearlas deberas mostrar al usuario un listado de acciones a ejecutar y si el usuario aprueba procedera.