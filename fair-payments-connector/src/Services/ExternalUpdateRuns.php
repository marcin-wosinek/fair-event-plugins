<?php
/**
 * External Updates operation log service
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

use FairPaymentsConnector\Database\ExternalUpdateRunRepository;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Server-owned runs for the External Updates page (#1695).
 *
 * The page starts a run before any work, then passes its ID to the existing
 * action endpoints, which record counts and close the run themselves. The
 * browser never reports counts or outcomes. Fair Payments Connector
 * Experimental calls this class for connected-site imports, so its public
 * static methods are a cross-plugin contract: add, don't change.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ExternalUpdateRuns {

	const ACTION_IMPORT_MOLLIE_PAYMENTS = 'import_mollie_payments';
	const ACTION_LOAD_MISSING_FEES      = 'load_missing_mollie_fees';
	const ACTION_IMPORT_CONNECTED_SITE  = 'import_connected_site';

	const SOURCE_MOLLIE         = 'mollie';
	const SOURCE_CONNECTED_SITE = 'connected_site';

	/**
	 * A running run whose heartbeat is older than this is interrupted.
	 *
	 * Every action records progress at least once per remote request, and
	 * each remote request times out after 30 seconds.
	 */
	const STALE_AFTER_SECONDS = 300;

	/**
	 * MySQL named lock serializing run starts.
	 */
	const START_LOCK = 'fair_payment_external_update_start';

	/**
	 * Map each action to the source type it runs against.
	 *
	 * @return array<string, string>
	 */
	public static function actions() {
		return array(
			self::ACTION_IMPORT_MOLLIE_PAYMENTS => self::SOURCE_MOLLIE,
			self::ACTION_LOAD_MISSING_FEES      => self::SOURCE_MOLLIE,
			self::ACTION_IMPORT_CONNECTED_SITE  => self::SOURCE_CONNECTED_SITE,
		);
	}

	/**
	 * Safe failure categories and their display messages.
	 *
	 * Only these codes are ever stored; anything else is recorded as
	 * `unknown`, so no remote text can reach the log.
	 *
	 * @return array<string, string>
	 */
	public static function error_messages() {
		return array(
			'remote_unreachable'      => __( 'The connected site could not be reached.', 'fair-payments-connector' ),
			'remote_rejected'         => __( 'The connected site rejected the access token.', 'fair-payments-connector' ),
			'remote_invalid_response' => __( 'The connected site returned an unexpected response.', 'fair-payments-connector' ),
			'source_unavailable'      => __( 'The source is no longer available.', 'fair-payments-connector' ),
			'mollie_not_connected'    => __( 'Mollie is not connected.', 'fair-payments-connector' ),
			'mollie_request_failed'   => __( 'Mollie could not be reached.', 'fair-payments-connector' ),
			'invalid_request'         => __( 'The request was not valid.', 'fair-payments-connector' ),
			'incomplete'              => __( 'Some requests did not complete.', 'fair-payments-connector' ),
			'interrupted'             => __( 'The run stopped before it finished, for example because a request timed out or the page was closed.', 'fair-payments-connector' ),
			'unknown'                 => __( 'The run failed.', 'fair-payments-connector' ),
		);
	}

	/**
	 * Start a run, refusing while another run is still active.
	 *
	 * @param array $data {
	 *     Run fields.
	 *
	 *     @type string   $action         One of the ACTION_* constants.
	 *     @type string   $source_id      Stable source ID.
	 *     @type string   $source_label   Display label snapshot (may be '').
	 *     @type int      $user_id        Initiating user.
	 *     @type int|null $expected_total Items the run will process, when known.
	 * }
	 * @return array|WP_Error The new run row, or 409 while another run is active.
	 */
	public static function start( array $data ) {
		global $wpdb;

		$actions = self::actions();
		if ( ! isset( $actions[ $data['action'] ] ) ) {
			return new WP_Error(
				'invalid_external_update_action',
				__( 'Unknown external update.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$locked = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK( %s, 5 )', self::START_LOCK ) );
		if ( 1 !== $locked ) {
			return self::busy_error( null );
		}

		try {
			self::interrupt_stale();

			$repository = new ExternalUpdateRunRepository();
			$running    = $repository->get_running();
			if ( $running ) {
				return self::busy_error( $running );
			}

			$id = $repository->insert(
				array(
					'source_type'    => $actions[ $data['action'] ],
					'source_id'      => substr( (string) $data['source_id'], 0, 64 ),
					'source_label'   => substr( sanitize_text_field( (string) ( $data['source_label'] ?? '' ) ), 0, 191 ),
					'action'         => $data['action'],
					'user_id'        => (int) $data['user_id'],
					'expected_total' => $data['expected_total'] ?? null,
				)
			);
		} finally {
			$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK( %s )', self::START_LOCK ) );
		}

		if ( ! $id ) {
			return new WP_Error(
				'external_update_not_started',
				__( 'The external update could not be started.', 'fair-payments-connector' ),
				array( 'status' => 500 )
			);
		}

		return $repository->get( $id );
	}

	/**
	 * Validate that the current user may record work on a run.
	 *
	 * @param int         $run_id    Run ID from the request.
	 * @param string      $action    Action the calling endpoint performs.
	 * @param string|null $source_id Source the calling endpoint works on, or null to skip.
	 * @return array|WP_Error The run row.
	 */
	public static function claim( $run_id, $action, $source_id = null ) {
		$repository = new ExternalUpdateRunRepository();
		$run        = $repository->get( (int) $run_id );

		if ( ! $run ) {
			return new WP_Error(
				'external_update_not_found',
				__( 'External update run not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		if ( get_current_user_id() !== (int) $run['user_id'] ) {
			return new WP_Error(
				'external_update_forbidden',
				__( 'This external update was started by another user.', 'fair-payments-connector' ),
				array( 'status' => 403 )
			);
		}

		if ( $run['action'] !== $action || ( null !== $source_id && (string) $run['source_id'] !== (string) $source_id ) ) {
			return new WP_Error(
				'external_update_mismatch',
				__( 'This external update run belongs to a different source or action.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		if ( 'running' !== $run['status'] ) {
			return new WP_Error(
				'external_update_finished',
				__( 'This external update run has already finished. Start a new run to try again.', 'fair-payments-connector' ),
				array( 'status' => 409 )
			);
		}

		return $run;
	}

	/**
	 * Record progress on a running run.
	 *
	 * @param int   $run_id Run ID.
	 * @param array $counts created/updated/skipped/failed deltas.
	 * @return void
	 */
	public static function record( $run_id, array $counts ) {
		( new ExternalUpdateRunRepository() )->add_counts( (int) $run_id, $counts );
	}

	/**
	 * Close a run, deriving its outcome from the counts the server recorded.
	 *
	 * @param int         $run_id     Run ID.
	 * @param string|null $error_code Failure category when the run stopped early.
	 * @param int         $add_failed Items that were never processed, counted as failed.
	 * @return array|null The closed run.
	 */
	public static function finish( $run_id, $error_code = null, $add_failed = 0 ) {
		$repository = new ExternalUpdateRunRepository();
		$run        = $repository->get( (int) $run_id );

		if ( ! $run ) {
			return null;
		}

		if ( null !== $error_code && ! array_key_exists( $error_code, self::error_messages() ) ) {
			$error_code = 'unknown';
		}

		$progress = (int) $run['created_count'] + (int) $run['updated_count'] + (int) $run['skipped_count'];
		$failed   = (int) $run['failed_count'] + max( 0, (int) $add_failed );

		if ( null !== $error_code || $failed > 0 ) {
			$status = $progress > 0 ? 'partial' : 'failed';
		} else {
			$status = 'succeeded';
		}

		$repository->close( (int) $run_id, $status, $error_code, $add_failed );

		return $repository->get( (int) $run_id );
	}

	/**
	 * Mark runs without a recent heartbeat as interrupted.
	 *
	 * @return void
	 */
	public static function interrupt_stale() {
		( new ExternalUpdateRunRepository() )->interrupt_stale(
			gmdate( 'Y-m-d H:i:s', time() - self::STALE_AFTER_SECONDS )
		);
	}

	/**
	 * Build the allowlisted REST shape of a run.
	 *
	 * @param array $run Run row.
	 * @return array
	 */
	public static function prepare_for_response( array $run ) {
		$user_id   = $run['user_id'] ? (int) $run['user_id'] : null;
		$user      = $user_id ? get_userdata( $user_id ) : false;
		$user_name = $user
			? $user->display_name
			/* translators: %d: WordPress user ID */
			: ( $user_id ? sprintf( __( 'Deleted user #%d', 'fair-payments-connector' ), $user_id ) : '' );

		$messages   = self::error_messages();
		$error_code = $run['error_code'] ? (string) $run['error_code'] : null;

		return array(
			'id'             => (int) $run['id'],
			'action'         => (string) $run['action'],
			'action_label'   => self::action_label( (string) $run['action'] ),
			'source_type'    => (string) $run['source_type'],
			'source_id'      => (string) $run['source_id'],
			'source_label'   => self::source_label( $run ),
			'status'         => (string) $run['status'],
			'user_id'        => $user_id,
			'user_name'      => $user_name,
			'started_at'     => get_date_from_gmt( $run['started_at'] ),
			'finished_at'    => $run['finished_at'] ? get_date_from_gmt( $run['finished_at'] ) : null,
			'expected_total' => null === $run['expected_total'] ? null : (int) $run['expected_total'],
			'counts'         => array(
				'created' => (int) $run['created_count'],
				'updated' => (int) $run['updated_count'],
				'skipped' => (int) $run['skipped_count'],
				'failed'  => (int) $run['failed_count'],
			),
			'error_code'     => $error_code,
			'error_message'  => $error_code ? ( $messages[ $error_code ] ?? $messages['unknown'] ) : null,
		);
	}

	/**
	 * Translated label for an action.
	 *
	 * @param string $action Action key.
	 * @return string
	 */
	private static function action_label( $action ) {
		switch ( $action ) {
			case self::ACTION_IMPORT_MOLLIE_PAYMENTS:
				return __( 'Import payments', 'fair-payments-connector' );
			case self::ACTION_LOAD_MISSING_FEES:
				return __( 'Load missing fees', 'fair-payments-connector' );
			case self::ACTION_IMPORT_CONNECTED_SITE:
				return __( 'Import transactions', 'fair-payments-connector' );
		}
		return $action;
	}

	/**
	 * Translated label for a run's source.
	 *
	 * @param array $run Run row.
	 * @return string
	 */
	private static function source_label( array $run ) {
		if ( self::SOURCE_MOLLIE === $run['source_type'] ) {
			switch ( $run['source_id'] ) {
				case 'live':
					return __( 'Mollie (live)', 'fair-payments-connector' );
				case 'test':
					return __( 'Mollie (test)', 'fair-payments-connector' );
				default:
					return __( 'Mollie (all modes)', 'fair-payments-connector' );
			}
		}

		if ( '' !== (string) $run['source_label'] ) {
			return (string) $run['source_label'];
		}

		/* translators: %s: connected site ID */
		return sprintf( __( 'Connected site #%s', 'fair-payments-connector' ), $run['source_id'] );
	}

	/**
	 * Error returned while another run is active.
	 *
	 * @param array|null $running The active run, when known.
	 * @return WP_Error
	 */
	private static function busy_error( $running ) {
		return new WP_Error(
			'external_update_in_progress',
			__( 'Another external update is still running. Wait for it to finish, then try again.', 'fair-payments-connector' ),
			array(
				'status' => 409,
				'run'    => $running ? self::prepare_for_response( $running ) : null,
			)
		);
	}
}
