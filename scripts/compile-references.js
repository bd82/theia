/********************************************************************************
 * Copyright (C) 2020 Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

/**
 * This script generates tsconfig references between our workspaces, it also
 * configures our .eslintrc file to use such references.
 *
 * `tsc` build mode relies on these references to build out of date dependencies
 * only when required, but it cannot infer workspaces by itself, it has to be
 * explicitly defined [1].
 *
 * [1]: https://www.typescriptlang.org/docs/handbook/project-references.html
 */

// @ts-check

const cp = require('child_process')
const path = require('path').posix
const fs = require('fs')

const CWD = path.join(__dirname, '..')

const FORCE_REWRITE = Boolean(process.env['THEIA_REPO_FORCE_REWRITE'])

/** @type {{ [packageName: string]: YarnWorkspace }} */
const YARN_WORKSPACES = JSON.parse(cp.execSync('yarn --silent workspaces info').toString())

/** @type {YarnWorkspace} */
const THEIA_MONOREPO = {
    workspaceDependencies: Object.keys(YARN_WORKSPACES),
    location: '.',
}

{
    // Configure all `compile.tsconfig.json` files of this monorepo
    for (const packageName of Object.keys(YARN_WORKSPACES)) {
        const workspacePackage = YARN_WORKSPACES[packageName]
        const tsconfigCompilePath = path.join(CWD, workspacePackage.location, 'compile.tsconfig.json')
        const references = getTypescriptReferences(workspacePackage)
        configureTypeScriptCompilation(tsconfigCompilePath, references)
    }
    const tsconfigCompilePath = path.join(CWD, 'compile.tsconfig.json')
    const references = getTypescriptReferences(THEIA_MONOREPO)
    configureTypeScriptCompilation(tsconfigCompilePath, references)

    // Configure the root `tsconfig.json` for code navigation using `tsserver`.
    configureTypeScriptNavigation()
}

/**
 * @param {YarnWorkspace} requestedPackage
 * @returns {string[]} project references for `requestedPackage`.
 */
function getTypescriptReferences(requestedPackage) {
    const references = []
    for (const dependency of requestedPackage.workspaceDependencies || []) {
        const depWorkspace = YARN_WORKSPACES[dependency]
        const depConfig = path.join(depWorkspace.location, 'compile.tsconfig.json')
        if (!fs.existsSync(depConfig)) {
            continue
        }
        const relativePath = path.relative(requestedPackage.location, depWorkspace.location)
        references.push(relativePath)
    }
    return references
}

/**
 * Wires a given compilation tsconfig file according to the provided references.
 * This allows TypeScript to operate in build mode.
 *
 * @param {string} tsconfigPath path to the tsconfig file to edit.
 * @param {string[]} references list of paths to the related project roots.
 */
function configureTypeScriptCompilation(tsconfigPath, references) {
    if (!fs.existsSync(tsconfigPath)) {
        return
    }
    let needRewrite = false
    const tsconfigJson = readJsonFile(tsconfigPath)
    if (!tsconfigJson.compilerOptions) {
        // Somehow no `compilerOptions` literal is defined.
        tsconfigJson.compilerOptions = {
            composite: true,
            rootDir: 'src',
            outDir: 'lib',
        }
    } else if (!tsconfigJson.compilerOptions.composite) {
        // `compilerOptions` is missing the `composite` literal.
        tsconfigJson.compilerOptions = {
            composite: true,
            ...tsconfigJson.compilerOptions,
        }
        needRewrite = true
    }
    const currentReferences = new Set((tsconfigJson['references'] || []).map(reference => reference.path))
    for (const reference of references) {
        const tsconfigReference = path.join(reference, 'compile.tsconfig.json')
        if (!currentReferences.has(tsconfigReference)) {
            currentReferences.add(tsconfigReference)
            needRewrite = true
        }
    }
    if (FORCE_REWRITE || needRewrite) {
        tsconfigJson.references = []
        for (const reference of currentReferences) {
            tsconfigJson.references.push({
                path: reference,
            })
        }
        const content = JSON.stringify(tsconfigJson, undefined, 2)
        fs.writeFileSync(tsconfigPath, content + '\n')
    }
}

/**
 * Wire the root `tsconfig.json` to map scoped import to real location in the monorepo.
 * This setup is a shim for the TypeScript language server to provide cross-package navigation.
 * Compilation is done via `compile.tsconfig.json` files.
 */
function configureTypeScriptNavigation() {
    let needRewrite = false
    const tsconfigPath = path.join(CWD, 'tsconfig.json')
    const tsconfigJson = readJsonFile(tsconfigPath)
    if (typeof tsconfigJson.compilerOptions === 'undefined') {
        // Somehow no `compilerOptions` literal is defined.
        tsconfigJson.compilerOptions = {
            baseUrl: '.',
            paths: {},
        }
        needRewrite = true
    } else if (typeof tsconfigJson.compilerOptions.paths === 'undefined') {
        // `compilerOptions` is missing the `paths` literal.
        tsconfigJson.compilerOptions = {
            ...tsconfigJson.compilerOptions,
            paths: {},
        }
        needRewrite = true
    }
    /** @type {{ [prefix: string]: string[] }} */
    const currentPaths = tsconfigJson.compilerOptions.paths
    for (const packageName of THEIA_MONOREPO.workspaceDependencies) {
        const depWorkspace = YARN_WORKSPACES[packageName]
        const depConfig = path.join(depWorkspace.location, 'compile.tsconfig.json')

        /** @type {string} */
        let originalPath
        /** @type {string} */
        let mappedPath

        if (fs.existsSync(depConfig)) {
            // If it is a TypeScript dependency, map `lib` imports to our local sources in `src`.
            originalPath = `${packageName}/lib/*`
            mappedPath = path.relative(THEIA_MONOREPO.location, path.join(depWorkspace.location, 'src', '*'))
        } else {
            // I don't really know what to do here, simply point to our local package root.
            originalPath = `${packageName}/*`
            mappedPath = path.relative(THEIA_MONOREPO.location, path.join(depWorkspace.location, '*'))
        }
        if (typeof currentPaths[originalPath] === 'undefined' || currentPaths[originalPath][0] !== mappedPath) {
            currentPaths[originalPath] = [mappedPath]
            needRewrite = true
        }
    }
    if (FORCE_REWRITE || needRewrite) {
        const content = JSON.stringify(tsconfigJson, undefined, 2)
        fs.writeFileSync(tsconfigPath, content + '\n')
    }
}

/**
 * @param {string} path
 * @returns {any}
 */
function readJsonFile(path) {
    try {
        return JSON.parse(fs.readFileSync(path).toString())
    } catch (error) {
        console.error('ParseError in file:', path);
        throw error;
    }
}

/**
 * @typedef YarnWorkspace
 * @property {string} location
 * @property {string[]} workspaceDependencies
 */
