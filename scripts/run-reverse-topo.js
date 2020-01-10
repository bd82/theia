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
 * This script will run a subcommand for each package in reverse-topology order.
 *
 * The command will be ran once per package, you can use the __PACKAGE__ tag in
 * your command and arguments and it will get replaced by the current package
 * from the iteration.
 */

// @ts-check

const cp = require('child_process')

const yarnWorkspaces = cp.execSync('yarn --silent workspaces info')
const lernaSort = cp.execSync('yarn --silent lerna ls --sort --json')

/** @type {LernaPackage[]} */
const packages = JSON.parse(lernaSort.toString())

/** @type {{ [key: string]: YarnWorkspace  }} */
const workspaces = JSON.parse(yarnWorkspaces.toString())

// reverse topology order
packages.reverse()

for (const package of packages) {
    const workspace = workspaces[package.name]
    const command = process.argv[2]
    const args = process.argv.slice(3).map(arg => arg.replace(/__PACKAGE__/g, package.name))
    console.log(`${package.name}: $ ${command} ${args.join(' ')}`)
    cp.spawnSync(command, args, {
        stdio: ['ignore', 'ignore', 'inherit'],
        cwd: workspace.location,
    })
}

/**
 * @typedef LernaPackage
 * @property {string} name
 */

/**
 * @typedef YarnWorkspace
 * @property {string} location
 */
