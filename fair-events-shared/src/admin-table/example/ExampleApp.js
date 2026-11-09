/**
 * Review example for the shared admin table (#2205). Test/dev only: the
 * e2e mu-plugin `fair-e2e-admin-table-example.php` serves it on the wp-env
 * tests site. Strings are plain English because nothing here ships; real
 * consumers pass translated labels.
 *
 * `?layout=baseline` renders the same rows with the conventions the four
 * lists use today, for before/after screenshots. `?scenario=` preselects a
 * state.
 *
 * @package FairEventsShared
 */

import { useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	SelectControl,
	TextControl,
} from '@wordpress/components';

import {
	AdminTable,
	AdminTableCell,
	AdminTableHeaderCell,
	ItemIdentity,
	RowActions,
	StatusLabel,
	TableMessage,
} from '../index.js';
import { EXAMPLE_ROWS, SCENARIOS } from './fixtures.js';

const UNTITLED = '(untitled entry)';
const nameOf = ( row ) => row.title || UNTITLED;

function readParam( name ) {
	return new URLSearchParams( window.location.search ).get( name ) || '';
}

function writeParam( name, value ) {
	const url = new URL( window.location.href );
	url.searchParams.set( name, value );
	window.history.replaceState( null, '', url );
}

const COLUMNS = {
	item: 'Item',
	date: 'Date',
	amount: 'Amount',
	status: 'Status',
	actions: 'Actions',
};

function BaselineTable( { rows } ) {
	return (
		<table className="wp-list-table widefat fixed striped">
			<thead>
				<tr>
					<th>{ COLUMNS.item }</th>
					<th>{ COLUMNS.date }</th>
					<th>{ COLUMNS.amount }</th>
					<th>{ COLUMNS.status }</th>
					<th>{ COLUMNS.actions }</th>
				</tr>
			</thead>
			<tbody>
				{ rows.map( ( row ) => (
					<tr key={ row.id }>
						<td>
							<strong>
								<a href={ `#item-${ row.id }` }>
									{ nameOf( row ) }
								</a>
							</strong>
							<br />
							<code>{ row.meta }</code>
						</td>
						<td>{ row.date }</td>
						<td>{ row.amount }</td>
						<td>{ row.status.label }</td>
						<td>
							<Button variant="secondary" size="small">
								{ row.primary }
							</Button>{ ' ' }
							{ row.secondary.length > 0 && (
								<>
									<Button variant="secondary" size="small">
										Duplicate
									</Button>{ ' ' }
									<Button
										variant="tertiary"
										size="small"
										isDestructive
									>
										Delete
									</Button>
								</>
							) }
						</td>
					</tr>
				) ) }
			</tbody>
		</table>
	);
}

export default function ExampleApp() {
	const layout = readParam( 'layout' );
	const initialScenario = SCENARIOS.some(
		( { value } ) => value === readParam( 'scenario' )
	)
		? readParam( 'scenario' )
		: 'rows';

	const [ scenario, setScenario ] = useState( initialScenario );
	const [ rows, setRows ] = useState(
		'empty' === initialScenario ? [] : EXAMPLE_ROWS
	);
	const [ search, setSearch ] = useState(
		'no-results' === initialScenario ? 'zzz' : ''
	);
	const [ busyIds, setBusyIds ] = useState(
		'pending' === initialScenario ? [ 4 ] : []
	);
	const [ reloading, setReloading ] = useState( false );
	const [ notice, setNotice ] = useState( '' );
	const [ deleting, setDeleting ] = useState( null );
	const headingRef = useRef( null );
	const timers = useRef( [] );

	useEffect( () => () => timers.current.forEach( clearTimeout ), [] );

	const later = ( callback, ms ) =>
		timers.current.push( setTimeout( callback, ms ) );

	const chooseScenario = ( value ) => {
		writeParam( 'scenario', value );
		setScenario( value );
		setRows( 'empty' === value ? [] : EXAMPLE_ROWS );
		setSearch( 'no-results' === value ? 'zzz' : '' );
		setBusyIds( 'pending' === value ? [ 4 ] : [] );
		setNotice( '' );
	};

	if ( 'baseline' === layout ) {
		return (
			<div className="wrap">
				<h1>Admin table example — current conventions</h1>
				<p>
					Foundation baseline (#2205): the same synthetic rows in the
					table conventions used by the lists today. Not a page
					migration.
				</p>
				<BaselineTable rows={ EXAMPLE_ROWS } />
			</div>
		);
	}

	const retryLoad = () => {
		setReloading( true );
		later( () => {
			setReloading( false );
			setScenario( 'rows' );
			writeParam( 'scenario', 'rows' );
		}, 800 );
	};

	const retrySend = ( row ) => {
		setBusyIds( ( ids ) => [ ...ids, row.id ] );
		later( () => {
			setBusyIds( ( ids ) => ids.filter( ( id ) => id !== row.id ) );
			setRows( ( current ) =>
				current.map( ( item ) =>
					item.id === row.id
						? {
								...item,
								warning: '',
								status: { tone: 'success', label: 'Sent' },
							}
						: item
				)
			);
			setNotice( `“${ nameOf( row ) }” was sent again.` );
		}, 1200 );
	};

	const duplicate = ( row ) => {
		const copy = {
			...row,
			id: Math.max( ...rows.map( ( item ) => item.id ) ) + 1,
			title: `Copy of ${ nameOf( row ) }`,
		};
		setRows( ( current ) => [ ...current, copy ] );
		setNotice( `“${ nameOf( row ) }” was duplicated.` );
	};

	const confirmDelete = () => {
		const { row } = deleting;
		setRows( ( current ) =>
			current.filter( ( item ) => item.id !== row.id )
		);
		setDeleting( null );
		setNotice( `“${ nameOf( row ) }” was deleted.` );
		// The row and its trigger are gone: move focus to the list heading.
		headingRef.current?.focus();
	};

	const cancelDelete = () => {
		const { restoreFocus } = deleting;
		setDeleting( null );
		restoreFocus();
	};

	const secondaryActions = ( row ) =>
		row.secondary.map( ( key ) => {
			switch ( key ) {
				case 'duplicate':
					return {
						label: 'Duplicate',
						onClick: () => duplicate( row ),
					};
				case 'duplicate-disabled':
					return {
						label: 'Duplicate',
						disabled: true,
						disabledReason: 'Finish the import before duplicating.',
					};
				case 'export':
					return {
						label: 'Export CSV',
						onClick: () =>
							setNotice( `“${ nameOf( row ) }” was exported.` ),
					};
				default:
					return {
						label: 'Delete',
						isDestructive: true,
						onClick: ( { restoreFocus } ) =>
							setDeleting( { row, restoreFocus } ),
					};
			}
		} );

	const primaryAction = ( row ) => {
		if ( 'Retry' === row.primary && 'error' === row.status.tone ) {
			return {
				label: 'Retry',
				busyLabel: 'Retrying…',
				isBusy: busyIds.includes( row.id ),
				onClick: () => retrySend( row ),
			};
		}
		if ( row.primaryDisabledReason ) {
			return {
				label: row.primary,
				disabled: true,
				disabledReason: row.primaryDisabledReason,
			};
		}
		return {
			label: row.primary,
			href: `#${ row.primary.toLowerCase() }-${ row.id }`,
		};
	};

	const term = search.trim().toLowerCase();
	const shown = rows.filter(
		( row ) =>
			! term ||
			`${ nameOf( row ) } ${ row.meta }`.toLowerCase().includes( term )
	);
	const failed = 'error' === scenario;

	let body;
	if ( 'loading' === scenario || reloading ) {
		body = <TableMessage status="loading">Loading entries…</TableMessage>;
	} else if ( 0 === rows.length ) {
		body = (
			<TableMessage status="empty">
				No entries yet. Entries appear here after the first import.
			</TableMessage>
		);
	} else if ( 0 === shown.length ) {
		body = (
			<TableMessage
				status="no-results"
				onClear={ () => setSearch( '' ) }
				clearLabel="Clear search"
			>
				{ `No entries match “${ search }”.` }
			</TableMessage>
		);
	} else {
		body = (
			<AdminTable caption="Example entries">
				<thead>
					<tr>
						<AdminTableHeaderCell variant="identity">
							{ COLUMNS.item }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell>
							{ COLUMNS.date }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell variant="amount">
							{ COLUMNS.amount }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell variant="status">
							{ COLUMNS.status }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell variant="actions">
							{ COLUMNS.actions }
						</AdminTableHeaderCell>
					</tr>
				</thead>
				<tbody>
					{ shown.map( ( row ) => (
						<tr key={ row.id }>
							<AdminTableCell
								label={ COLUMNS.item }
								variant="identity"
							>
								<ItemIdentity
									title={ row.title }
									fallback={ UNTITLED }
									href={ `#item-${ row.id }` }
									meta={ row.meta }
								>
									{ row.warning && (
										<span className="fair-admin-table__warning">
											{ row.warning }
										</span>
									) }
								</ItemIdentity>
							</AdminTableCell>
							<AdminTableCell label={ COLUMNS.date }>
								{ row.date || 'Not scheduled' }
							</AdminTableCell>
							<AdminTableCell
								label={ COLUMNS.amount }
								variant="amount"
							>
								{ row.amount || '—' }
							</AdminTableCell>
							<AdminTableCell
								label={ COLUMNS.status }
								variant="status"
							>
								<StatusLabel tone={ row.status.tone }>
									{ row.status.label }
								</StatusLabel>
							</AdminTableCell>
							<AdminTableCell
								label={ COLUMNS.actions }
								variant="actions"
							>
								<RowActions
									primary={ primaryAction( row ) }
									secondary={ secondaryActions( row ) }
									moreLabel={ `More actions for “${ nameOf(
										row
									) }”` }
								/>
							</AdminTableCell>
						</tr>
					) ) }
				</tbody>
			</AdminTable>
		);
	}

	return (
		<div className="wrap fair-admin-table-example">
			<h1 ref={ headingRef } tabIndex={ -1 }>
				Admin table example
			</h1>
			<p>
				Foundation example (#2205) with synthetic data. Actions only
				change this page’s local state; this is not a page migration.
			</p>
			<div className="fair-admin-table-example__toolbar">
				<TextControl
					label="Search entries"
					value={ search }
					onChange={ setSearch }
				/>
				<SelectControl
					label="Scenario"
					value={ scenario }
					options={ SCENARIOS }
					onChange={ chooseScenario }
				/>
				{ ! reloading && 'loading' !== scenario && (
					<p
						className="fair-admin-table-example__count"
						role="status"
					>
						{ `${ shown.length } of ${ rows.length } entries` }
					</p>
				) }
			</div>
			{ notice && (
				<Notice status="success" onRemove={ () => setNotice( '' ) }>
					{ notice }
				</Notice>
			) }
			{ failed && ! reloading && (
				<TableMessage
					status="error"
					onRetry={ retryLoad }
					retryLabel="Try again"
				>
					The entries could not be refreshed. The list below may be
					out of date.
				</TableMessage>
			) }
			{ body }
			{ deleting && (
				<Modal
					title={ `Delete entry — ${ nameOf( deleting.row ) }` }
					onRequestClose={ cancelDelete }
					style={ { maxWidth: '560px', width: '100%' } }
				>
					<p>
						This removes the example row from this page only. Reload
						the page to bring it back.
					</p>
					<div className="fair-admin-table-example__modal-actions">
						<Button variant="tertiary" onClick={ cancelDelete }>
							Cancel
						</Button>
						<Button
							variant="primary"
							isDestructive
							onClick={ confirmDelete }
						>
							Delete entry
						</Button>
					</div>
				</Modal>
			) }
		</div>
	);
}
