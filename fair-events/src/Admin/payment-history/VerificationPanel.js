/**
 * Verification report: old and new records compared per event date.
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	Spinner,
	ToggleControl,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { revenueCauseLabels } from './labels.js';
import { formatAmount, formatEventDate } from './format.js';

const PER_PAGE = 10;

/**
 * One event date's comparison.
 *
 * @param {Object} props
 * @param {Object} props.item Comparison.
 * @return {JSX.Element} Row.
 */
function ComparisonRow( { item } ) {
	const causes = revenueCauseLabels();
	const { admissions, revenue } = item;
	const differences = Object.entries( revenue?.currencies || {} ).flatMap(
		( [ currency, summary ] ) =>
			( summary.differences || [] ).map( ( difference ) => ( {
				...difference,
				currency,
			} ) )
	);

	return (
		<li className="fair-events-payment-history__comparison">
			<HStack justify="space-between" wrap alignment="top">
				<strong>{ formatEventDate( item.event_date ) }</strong>
				<span className="fair-events-payment-history__badges">
					{ item.blocking && (
						<span className="fair-events-payment-history__badge is-error">
							{ __( 'Unexplained difference', 'fair-events' ) }
						</span>
					) }
					{ item.revenue_state === 'incomplete' && (
						<span className="fair-events-payment-history__badge is-warning">
							{ __( 'Revenue incomplete', 'fair-events' ) }
						</span>
					) }
					{ ! item.blocking &&
						item.revenue_state !== 'incomplete' && (
							<span className="fair-events-payment-history__badge is-success">
								{ __( 'Matches', 'fair-events' ) }
							</span>
						) }
				</span>
			</HStack>
			<p>
				{ sprintf(
					/* translators: 1: tickets counted from the old records, 2: tickets counted from the new records */
					__(
						'Tickets: %1$d in the old records, %2$d in the new ones.',
						'fair-events'
					),
					admissions?.source ?? 0,
					admissions?.target ?? 0
				) }
				{ admissions?.explained?.legacy_rule
					? ' ' +
						sprintf(
							/* translators: %d: number of registrations the new rule counts */
							_n(
								'%d registration counts now that an earlier failed checkout no longer hides it.',
								'%d registrations count now that an earlier failed checkout no longer hides them.',
								admissions.explained.legacy_rule,
								'fair-events'
							),
							admissions.explained.legacy_rule
						)
					: '' }
			</p>
			{ Object.entries( revenue?.currencies || {} ).map(
				( [ currency, summary ] ) => (
					<p key={ currency }>
						{ sprintf(
							/* translators: 1: revenue in the old records, 2: revenue in the new records */
							__(
								'Revenue: %1$s in the old records, %2$s in the new ones.',
								'fair-events'
							),
							formatAmount( summary.source, currency ),
							formatAmount( summary.target, currency )
						) }
					</p>
				)
			) }
			{ differences.length > 0 && (
				<ul className="fair-events-payment-history__list">
					{ differences.map( ( difference ) => (
						<li
							key={ `${ difference.currency }-${ difference.transaction_id }` }
						>
							{ sprintf(
								/* translators: 1: payment number, 2: amount in the old records, 3: amount in the new records, 4: reason for the difference */
								__(
									'Payment #%1$d: %2$s before, %3$s now — %4$s',
									'fair-events'
								),
								difference.transaction_id,
								formatAmount(
									difference.source,
									difference.currency
								),
								formatAmount(
									difference.target,
									difference.currency
								),
								causes[ difference.cause ] ?? difference.cause
							) }
						</li>
					) ) }
				</ul>
			) }
			{ Object.entries( revenue?.series_pass_revenue || {} ).map(
				( [ currency, amount ] ) => (
					<p
						key={ currency }
						className="fair-events-payment-history__hint"
					>
						{ sprintf(
							/* translators: %s: series pass revenue covering this session */
							__(
								'Series passes covering this session: %s, counted once on the series.',
								'fair-events'
							),
							formatAmount( amount, currency )
						) }
					</p>
				)
			) }
		</li>
	);
}

/**
 * The verification card.
 *
 * @param {Object} props
 * @param {Object} props.summary    event_dates, blocking, incomplete.
 * @param {number} props.refreshKey Changes when the report should reload.
 * @return {JSX.Element} Card.
 */
export default function VerificationPanel( { summary, refreshKey } ) {
	const [ onlyProblems, setOnlyProblems ] = useState( false );
	const [ page, setPage ] = useState( 1 );
	const [ state, setState ] = useState( {
		loading: true,
		items: [],
		totalPages: 1,
		error: null,
	} );

	useEffect( () => {
		let active = true;
		setState( ( previous ) => ( {
			...previous,
			loading: true,
			error: null,
		} ) );
		const query = new URLSearchParams( {
			page: String( page ),
			per_page: String( PER_PAGE ),
			blocking: onlyProblems ? 'true' : 'false',
		} );
		apiFetch( {
			path: `/fair-events/v1/payment-history/comparisons?${ query }`,
			parse: false,
		} )
			.then( async ( response ) => {
				const items = await response.json();
				if ( active ) {
					setState( {
						loading: false,
						items,
						totalPages:
							Number(
								response.headers.get( 'X-WP-TotalPages' )
							) || 1,
						error: null,
					} );
				}
			} )
			.catch( ( e ) => {
				if ( active ) {
					setState( {
						loading: false,
						items: [],
						totalPages: 1,
						error:
							e?.message ||
							__(
								'The verification report couldn’t be loaded.',
								'fair-events'
							),
					} );
				}
			} );
		return () => {
			active = false;
		};
	}, [ page, onlyProblems, refreshKey ] );

	return (
		<Card className="fair-events-payment-history__card">
			<CardHeader>
				<h2>{ __( 'Verification', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				{ ! summary?.event_dates ? (
					<p>
						{ __(
							'The verification report appears here once the migration has compared every event date.',
							'fair-events'
						) }
					</p>
				) : (
					<>
						<p>
							{ sprintf(
								/* translators: 1: number of event dates compared, 2: number with unexplained differences, 3: number with incomplete revenue */
								__(
									'Event dates compared: %1$d. With unexplained differences: %2$d. With incomplete revenue: %3$d.',
									'fair-events'
								),
								summary.event_dates,
								summary.blocking,
								summary.incomplete
							) }
						</p>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Show only dates with unexplained differences',
								'fair-events'
							) }
							checked={ onlyProblems }
							onChange={ ( value ) => {
								setOnlyProblems( value );
								setPage( 1 );
							} }
						/>
						{ state.error && (
							<Notice status="error" isDismissible={ false }>
								{ state.error }
							</Notice>
						) }
						{ state.loading && <Spinner /> }
						{ ! state.loading &&
							! state.error &&
							state.items.length === 0 && (
								<p>
									{ __(
										'No event dates to show.',
										'fair-events'
									) }
								</p>
							) }
						<ul className="fair-events-payment-history__comparisons">
							{ state.items.map( ( item ) => (
								<ComparisonRow key={ item.id } item={ item } />
							) ) }
						</ul>
						{ state.totalPages > 1 && (
							<HStack justify="flex-start" spacing={ 3 } wrap>
								<Button
									variant="secondary"
									disabled={ page <= 1 }
									onClick={ () => setPage( page - 1 ) }
								>
									{ __( 'Previous page', 'fair-events' ) }
								</Button>
								<span>
									{ sprintf(
										/* translators: 1: current page number, 2: number of pages */
										__(
											'Page %1$d of %2$d',
											'fair-events'
										),
										page,
										state.totalPages
									) }
								</span>
								<Button
									variant="secondary"
									disabled={ page >= state.totalPages }
									onClick={ () => setPage( page + 1 ) }
								>
									{ __( 'Next page', 'fair-events' ) }
								</Button>
							</HStack>
						) }
					</>
				) }
			</CardBody>
		</Card>
	);
}
