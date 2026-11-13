/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { useConfirmAction } from '../ConfirmActionModal.js';

export const PER_PAGE = 50;
export const DEFAULT_CLEANUP_DAYS = 90;

/**
 * State and requests of one connection-log screen: the list with its filter,
 * sort and page, the statistics, and the cleanup confirmation.
 *
 * Every mounted screen owns its state. A list or statistics response is
 * applied only while it answers the latest request of that kind and the
 * screen is still mounted, so a slow response cannot overwrite newer results.
 *
 * @param {Object}   options               Hook options.
 * @param {Object}   options.api           Provider operations.
 * @param {Function} options.api.list      Resolves a list page; receives the query string.
 * @param {Function} options.api.stats     Resolves the statistics.
 * @param {Function} options.api.cleanup   Deletes log entries older than the given days.
 * @param {string}   options.listErrorText Fallback message when the list fails.
 * @return {Object} Screen state and handlers.
 */
export default function useConnectionManagement( { api, listErrorText } ) {
	const [ connections, setConnections ] = useState( [] );
	const [ statistics, setStatistics ] = useState( null );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ page, setPage ] = useState( 1 );
	const [ totalPages, setTotalPages ] = useState( 1 );
	const [ statusFilter, setStatusFilter ] = useState( '' );
	const [ orderBy, setOrderBy ] = useState( 'connected_at' );
	const [ order, setOrder ] = useState( 'DESC' );
	const [ cleanupDays, setCleanupDays ] = useState( DEFAULT_CLEANUP_DAYS );
	const [ cleanupResult, setCleanupResult ] = useState( null );
	const cleanup = useConfirmAction();

	const mounted = useRef( true );
	const listRequest = useRef( 0 );
	const statsRequest = useRef( 0 );

	useEffect( () => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, [] );

	const isCurrent = ( counter, id ) =>
		mounted.current && counter.current === id;

	const fetchConnections = async () => {
		const id = ++listRequest.current;
		setLoading( true );
		setError( null );

		try {
			const params = new URLSearchParams( {
				page: page.toString(),
				per_page: String( PER_PAGE ),
				orderby: orderBy,
				order,
			} );

			if ( statusFilter ) {
				params.set( 'status', statusFilter );
			}

			const data = await api.list( params.toString() );
			if ( ! isCurrent( listRequest, id ) ) {
				return;
			}
			setConnections( data.items || [] );
			setTotalPages( data.total_pages || 1 );
		} catch ( err ) {
			if ( isCurrent( listRequest, id ) ) {
				setError( err.message || listErrorText );
			}
		} finally {
			if ( isCurrent( listRequest, id ) ) {
				setLoading( false );
			}
		}
	};

	const fetchStatistics = async () => {
		const id = ++statsRequest.current;
		try {
			const data = await api.stats();
			if ( isCurrent( statsRequest, id ) ) {
				setStatistics( data );
			}
		} catch ( err ) {
			if ( isCurrent( statsRequest, id ) ) {
				// eslint-disable-next-line no-console
				console.error( 'Failed to load statistics:', err );
			}
		}
	};

	useEffect( () => {
		fetchConnections();
		fetchStatistics();
	}, [ page, statusFilter, orderBy, order ] );

	const openCleanup = () => {
		setCleanupResult( null );
		cleanup.open( { days: cleanupDays } );
	};

	const confirmCleanup = () =>
		cleanup.run(
			async ( { days } ) => {
				const data = await api.cleanup( days );
				if ( ! mounted.current ) {
					return;
				}
				setCleanupResult(
					data.message ||
						__(
							'Old logs cleaned up successfully',
							'fair-platform'
						)
				);
				fetchConnections();
				fetchStatistics();
			},
			__(
				'The old logs could not be deleted. Try again.',
				'fair-platform'
			)
		);

	return {
		connections,
		statistics,
		loading,
		error,
		page,
		setPage,
		totalPages,
		statusFilter,
		setStatusFilter,
		orderBy,
		setOrderBy,
		order,
		setOrder,
		cleanupDays,
		setCleanupDays,
		cleanupResult,
		setCleanupResult,
		cleanup,
		openCleanup,
		confirmCleanup,
	};
}
