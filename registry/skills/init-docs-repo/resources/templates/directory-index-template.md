---
template_purpose: "Establecer la estructura estándar, completa y profesional para los archivos README.md que actúan como índice y punto de entrada de cada directorio principal."
interview_questions:
  - id: "es_directory_name"
    question: "¿Cuál es el título formal de este directorio (ej. Índices de Arquitectura, Guías de Operación)?"
    description: "El título principal (H1) del documento."
  - id: "es_directory_purpose"
    question: "¿Cuál es el propósito fundamental y alcance de este directorio?"
    description: "Un párrafo introductorio detallando qué tipo de información vive aquí, a quién va dirigida y su importancia."
  - id: "es_directory_structure"
    question: "¿Existen subdirectorios clave dentro de esta carpeta que deban explicarse?"
    description: "Descripción breve de las subcarpetas principales (si aplica). Dejar vacío si es una sola lista de archivos."
  - id: "es_directory_rules"
    question: "¿Qué reglas, estándares o plantillas específicas aplican para contribuir contenido en este directorio?"
    description: "Reglas de qué sí y qué NO documentar aquí, además de plantillas requeridas."
  - id: "es_directory_owners"
    question: "¿Quiénes son los referentes técnicos, owners o aprobadores de la documentación en este nivel?"
    description: "Nombres, áreas o roles de quienes validan este contenido."
---

# `{{es_directory_name}}`

## 📖 Propósito y Alcance

Este directorio consolida la documentación relacionada con **`{{es_directory_purpose}}`**.

Toda la información contenida en esta sección es aplicable a nivel transversal en CSCTI, constituyendo la fuente de verdad oficial para las temáticas abarcadas.

## 📂 Estructura del Directorio

> **Nota:** `{{es_directory_structure}}`

- `📁 subdirectorio-ejemplo/`: Descripción de qué contiene.
- `📄 archivo-ejemplo.md`: Descripción puntual si es un documento pilar.

## 📑 Índice de Contenidos

### Categoría 1
- [ ] [Enlace al Documento 1](./ruta)
- [ ] [Enlace al Documento 2](./ruta)

### Categoría 2
- [ ] [Enlace al Documento 3](./ruta)

## ✍️ Guías de Contribución Específicas

Para añadir o modificar contenido dentro de este directorio, por favor sigue los lineamientos transversales de [CONTRIBUTING.md](../../CONTRIBUTING.md) y considera estas reglas específicas:

- `{{es_directory_rules}}`

> Todos los nuevos documentos en esta carpeta deben utilizar su plantilla correspondiente desde `docs/templates/`.

## 👥 Referentes y Aprobadores

Las decisiones, estándares y documentos en esta rama son mantenidos o validados por:
- `{{es_directory_owners}}`
