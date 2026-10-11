<?php
/**
 * Resumable settlement imports from Mollie
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

use FairPaymentsConnector\Database\SettlementRepository;
use FairPaymentsConnector\OAuth\GrantedScopes;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Payment\MollieSettlementProvider;
use FairPaymentsConnector\Payment\SettlementProviderException;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Loads settlements from Mollie in administrator-triggered batches (#1694).
 *
 * A run is a server-held cursor. Each step issues one Mollie request, saves
 * what it returned, and only then advances the cursor, so a step that dies
 * can be repeated without duplicating or skipping anything. A settlement's
 * new revision is published once every page of it has been retrieved; until
 * then its previous revision stays in place. A run belongs to the Mollie
 * organization that was connected when it started and refuses to continue
 * for any other.
 */
class SettlementApiImport {

	const KIND_HISTORY = 'history';
	const KIND_REFRESH = 'refresh';

	/**
	 * A running run whose heartbeat is older than this is interrupted.
	 * Each step makes one request with a 30-second timeout.
	 */
	const STALE_AFTER_SECONDS = 300;

	/**
	 * Settlements requested per list page.
	 */
	const LIST_LIMIT = 50;

	/**
	 * Movements requested per page.
	 */
	const PAGE_LIMIT = 250;

	/**
	 * MySQL named lock serializing run starts.
	 */
	const START_LOCK = 'fair_payment_settlement_import_start';

	/**
	 * Repository.
	 *
	 * @var SettlementRepository
	 */
	private $repository;

	/**
	 * Store.
	 *
	 * @var SettlementStore
	 */
	private $store;

	/**
	 * Provider, built on first use.
	 *
	 * @var MollieSettlementProvider|null
	 */
	private $provider;

	/**
	 * Constructor.
	 *
	 * @param MollieSettlementProvider|null $provider   Provider (for tests).
	 * @param SettlementRepository|null     $repository Repository.
	 */
	public function __construct( ?MollieSettlementProvider $provider = null, ?SettlementRepository $repository = null ) {
		$this->provider   = $provider;
		$this->repository = $repository ?? new SettlementRepository();
		$this->store      = new SettlementStore( $this->repository );
	}

	/**
	 * Safe failure categories and their messages.
	 *
	 * Only these codes are ever stored, so no provider text reaches the log.
	 *
	 * @return array<string, string>
	 */
	public static function error_messages() {
		return array(
			'mollie_not_connected'      => __( 'Mollie is not connected. Connect Mollie in Fair Payments Connector settings, then continue.', 'fair-payments-connector' ),
			'settlement_access_missing' => __( 'The Mollie connection does not have permission to read settlements. Reconnect Mollie in Fair Payments Connector settings and approve settlement access, then continue.', 'fair-payments-connector' ),
			'account_unknown'           => __( 'The connected Mollie organization is not known. Reconnect Mollie in Fair Payments Connector settings.', 'fair-payments-connector' ),
			'account_switched'          => __( 'Mollie is now connected to a different organization than when this import started, so it was stopped. Start a new import for the connected organization.', 'fair-payments-connector' ),
			'mollie_request_failed'     => __( 'Mollie could not be reached or returned an error. Nothing already saved was changed; continue to try again.', 'fair-payments-connector' ),
			'mollie_invalid_response'   => __( 'Mollie returned data that could not be read. Nothing already saved was changed.', 'fair-payments-connector' ),
			'interrupted'               => __( 'The import stopped before it finished, for example because a request timed out or the page was closed. Continue to pick up where it stopped.', 'fair-payments-connector' ),
			'replaced'                  => __( 'A newer import was started instead.', 'fair-payments-connector' ),
			'not_saved'                 => __( 'The data could not be saved. Continue to try again.', 'fair-payments-connector' ),
		);
	}

	/**
	 * Why Mollie cannot be read right now, if it cannot.
	 *
	 * @return string|null Failure category, or null when access is in place.
	 */
	public static function access_problem() {
		if ( ! MolliePaymentHandler::is_configured() ) {
			return 'mollie_not_connected';
		}
		if ( ! GrantedScopes::has_settlement_access() ) {
			return 'settlement_access_missing';
		}
		if ( '' === self::connected_organization() ) {
			return 'account_unknown';
		}
		return null;
	}

	/**
	 * The Mollie organization this site is connected to.
	 *
	 * @return string Organization ID, or '' when unknown.
	 */
	public static function connected_organization() {
		$organization = get_option( 'fair_payment_organization_id', '' );

		return is_string( $organization ) && 1 === preg_match( '/^[A-Za-z0-9_]{1,64}$/', $organization ) ? $organization : '';
	}

	/**
	 * Start an import run.
	 *
	 * @param string   $kind          KIND_HISTORY or KIND_REFRESH.
	 * @param int|null $settlement_id Settlement to refresh.
	 * @param int      $user_id       Initiating user.
	 * @return array|WP_Error The new run row.
	 */
	public function start( $kind, $settlement_id, $user_id ) {
		$problem = self::access_problem();
		if ( null !== $problem ) {
			return new WP_Error(
				$problem,
				self::error_messages()[ $problem ],
				array( 'status' => 'settlement_access_missing' === $problem ? 403 : 409 )
			);
		}

		$organization = self::connected_organization();
		$account      = $this->store->ensure_connected_account( $organization );
		if ( is_wp_error( $account ) ) {
			return $account;
		}

		$state = array(
			'list_from' => null,
			'list_done' => false,
			'queue'     => array(),
			'current'   => null,
		);

		if ( self::KIND_REFRESH === $kind ) {
			$settlement = $this->repository->get_settlement( (int) $settlement_id );
			if ( ! $settlement ) {
				return new WP_Error( 'settlement_not_found', __( 'Settlement not found.', 'fair-payments-connector' ), array( 'status' => 404 ) );
			}
			if ( (int) $settlement['account_id'] !== (int) $account['id'] ) {
				return new WP_Error(
					'settlement_account_mismatch',
					__( 'This settlement belongs to a different account than the Mollie organization that is connected, so it cannot be refreshed.', 'fair-payments-connector' ),
					array( 'status' => 409 )
				);
			}
			if ( null === $settlement['provider_id'] ) {
				return new WP_Error(
					'settlement_not_from_mollie',
					__( 'This settlement was only imported from a file. Load settlements from Mollie to match it with the provider record.', 'fair-payments-connector' ),
					array( 'status' => 409 )
				);
			}
			$state['list_done'] = true;
			$state['queue']     = array( $settlement['provider_id'] );
		} else {
			$settlement_id = null;
		}

		if ( ! $this->repository->lock( self::START_LOCK, 5 ) ) {
			return self::busy_error( null );
		}

		try {
			$this->interrupt_stale();

			$running = $this->repository->find_runs_by_status( array( 'running' ) );
			if ( ! empty( $running ) ) {
				return self::busy_error( $running[0] );
			}

			// A new run replaces unfinished ones; their unpublished work is dropped.
			foreach ( $this->repository->find_runs_by_status( array( 'failed', 'interrupted' ) ) as $unfinished ) {
				$this->abandon( $unfinished, 'replaced' );
			}

			$id = $this->repository->insert_run(
				array(
					'kind'            => $kind,
					'account_id'      => (int) $account['id'],
					'organization_id' => $organization,
					'settlement_id'   => $settlement_id ? (int) $settlement_id : null,
					'user_id'         => (int) $user_id,
					'state'           => wp_json_encode( $state ),
				)
			);
		} finally {
			$this->repository->unlock( self::START_LOCK );
		}

		if ( ! $id ) {
			return new WP_Error( 'settlement_import_not_started', __( 'The import could not be started.', 'fair-payments-connector' ), array( 'status' => 500 ) );
		}

		return $this->repository->get_run( $id );
	}

	/**
	 * Advance a run by one Mollie request, resuming it when it had stopped.
	 *
	 * @param int $run_id Run ID.
	 * @return array|WP_Error The run row after the step.
	 */
	public function step( $run_id ) {
		$lock = 'fair_payment_settlement_run_' . (int) $run_id;
		if ( ! $this->repository->lock( $lock, 0 ) ) {
			return new WP_Error(
				'settlement_import_busy',
				__( 'This import is already being continued in another request.', 'fair-payments-connector' ),
				array( 'status' => 409 )
			);
		}

		try {
			$run = $this->repository->get_run( (int) $run_id );
			if ( ! $run ) {
				return new WP_Error( 'settlement_import_not_found', __( 'Import not found.', 'fair-payments-connector' ), array( 'status' => 404 ) );
			}
			if ( ! in_array( $run['status'], array( 'running', 'failed', 'interrupted' ), true ) ) {
				return new WP_Error(
					'settlement_import_finished',
					__( 'This import has already finished. Start a new one to load again.', 'fair-payments-connector' ),
					array( 'status' => 409 )
				);
			}

			$organization = self::connected_organization();
			if ( '' !== $organization && $organization !== $run['organization_id'] ) {
				$this->abandon( $run, 'account_switched' );
				return $this->repository->get_run( (int) $run_id );
			}

			$problem = self::access_problem();
			if ( null !== $problem ) {
				$this->fail( $run, $problem );
				return $this->repository->get_run( (int) $run_id );
			}

			// Resuming must not overtake a run that started in the meantime.
			if ( 'running' !== $run['status'] ) {
				foreach ( $this->repository->find_runs_by_status( array( 'running' ) ) as $other ) {
					if ( (int) $other['id'] !== (int) $run_id ) {
						return self::busy_error( $other );
					}
				}
			}

			try {
				$this->advance( $run );
			} catch ( SettlementProviderException $e ) {
				$this->fail( $run, $e->get_category() );
			}

			return $this->repository->get_run( (int) $run_id );
		} finally {
			$this->repository->unlock( $lock );
		}
	}

	/**
	 * Do the next unit of work of a run.
	 *
	 * @param array $run Run row.
	 * @return void
	 * @throws SettlementProviderException When Mollie cannot answer.
	 */
	private function advance( array $run ) {
		$run_id   = (int) $run['id'];
		$state    = (array) json_decode( (string) $run['state'], true );
		$provider = $this->provider();
		$done     = (int) $run['settlements_done'];
		$account  = $this->repository->get_account( (int) $run['account_id'] );

		if ( ! $account ) {
			$this->abandon( $run, 'account_switched' );
			return;
		}

		if ( ! empty( $state['current'] ) ) {
			$current = $state['current'];
			$part    = MollieSettlementProvider::PARTS[ (int) $current['part'] ];
			$page    = $provider->list_movements( $current['provider_id'], $part, $current['from'], self::PAGE_LIMIT );

			// Saved before the cursor moves: repeating this page replaces the same rows.
			$this->repository->save_items( (int) $current['revision_id'], $page['movements'] );

			if ( null !== $page['next'] ) {
				$current['from'] = $page['next'];
			} else {
				$current['part'] = (int) $current['part'] + 1;
				$current['from'] = null;
			}

			if ( $current['part'] >= count( MollieSettlementProvider::PARTS ) ) {
				$published = $this->store->publish_api_revision( (int) $current['revision_id'] );
				if ( is_wp_error( $published ) ) {
					$this->fail( $run, 'not_saved' );
					return;
				}
				$current = null;
				++$done;
			}
			$state['current'] = $current;
		} elseif ( ! empty( $state['queue'] ) ) {
			$provider_id   = (string) $state['queue'][0];
			$settlement    = $provider->get_settlement( $provider_id );
			$settlement_id = $this->store->upsert_api_settlement( $account, $settlement['facts'] );
			$revision_id   = is_wp_error( $settlement_id )
				? $settlement_id
				: $this->store->stage_api_revision( $settlement_id, $run_id, $settlement['facts'], $settlement['aggregates'], $settlement['summary_check'] );

			if ( is_wp_error( $revision_id ) ) {
				$this->fail( $run, 'not_saved' );
				return;
			}

			array_shift( $state['queue'] );
			$state['current'] = array(
				'provider_id'   => $provider_id,
				'settlement_id' => (int) $settlement_id,
				'revision_id'   => (int) $revision_id,
				'part'          => 0,
				'from'          => null,
			);
		} elseif ( empty( $state['list_done'] ) ) {
			$page = $provider->list_settlements( $state['list_from'] ?? null, self::LIST_LIMIT );

			foreach ( $page['settlements'] as $facts ) {
				// Listed settlements show up straight away, marked incomplete.
				if ( is_wp_error( $this->store->upsert_api_settlement( $account, $facts ) ) ) {
					$this->fail( $run, 'not_saved' );
					return;
				}
				$state['queue'][] = $facts['provider_id'];
			}

			$state['list_from'] = $page['next'];
			$state['list_done'] = null === $page['next'];
		}

		$finished = empty( $state['current'] ) && empty( $state['queue'] ) && ! empty( $state['list_done'] );

		$this->repository->update_run(
			$run_id,
			array(
				'status'           => $finished ? 'completed' : 'running',
				'state'            => wp_json_encode( $state ),
				'settlements_done' => $done,
				'requests_done'    => (int) $run['requests_done'] + 1,
				'error_code'       => null,
				'finished_at'      => $finished ? current_time( 'mysql', true ) : null,
			)
		);
	}

	/**
	 * Stop a run on a failure it can be continued from.
	 *
	 * The cursor and everything saved so far are kept, and the failure is
	 * recorded on the settlement being loaded without touching its data.
	 *
	 * @param array  $run  Run row.
	 * @param string $code Safe failure category.
	 * @return void
	 */
	private function fail( array $run, $code ) {
		$code = array_key_exists( $code, self::error_messages() ) ? $code : 'mollie_request_failed';

		$this->repository->update_run(
			(int) $run['id'],
			array(
				'status'     => 'failed',
				'error_code' => $code,
			)
		);

		$settlement_id = $this->settlement_in_progress( $run );
		if ( $settlement_id ) {
			$this->store->record_failure( $settlement_id, $code );
		}
	}

	/**
	 * Close a run for good and drop what it had not published.
	 *
	 * @param array  $run  Run row.
	 * @param string $code Safe failure category.
	 * @return void
	 */
	private function abandon( array $run, $code ) {
		foreach ( $this->repository->find_staged_revisions_of_run( (int) $run['id'] ) as $staged ) {
			$this->repository->delete_staged_revision( (int) $staged['id'] );
		}

		$this->repository->update_run(
			(int) $run['id'],
			array(
				'status'      => 'aborted',
				'error_code'  => $code,
				'finished_at' => current_time( 'mysql', true ),
			)
		);
	}

	/**
	 * The settlement a run was loading when it stopped, if it is known locally.
	 *
	 * @param array $run Run row.
	 * @return int|null
	 */
	private function settlement_in_progress( array $run ) {
		$state = (array) json_decode( (string) $run['state'], true );

		if ( ! empty( $state['current']['settlement_id'] ) ) {
			return (int) $state['current']['settlement_id'];
		}
		if ( ! empty( $state['queue'][0] ) ) {
			$settlement = $this->repository->find_settlement_by_provider_id( (int) $run['account_id'], (string) $state['queue'][0] );
			return $settlement ? (int) $settlement['id'] : null;
		}

		return null;
	}

	/**
	 * Mark runs without a recent heartbeat as interrupted.
	 *
	 * @return void
	 */
	public function interrupt_stale() {
		$this->repository->interrupt_stale_runs( gmdate( 'Y-m-d H:i:s', time() - self::STALE_AFTER_SECONDS ) );
	}

	/**
	 * The run an administrator can watch or continue, if any.
	 *
	 * @return array|null
	 */
	public function get_open_run() {
		$this->interrupt_stale();
		$runs = $this->repository->find_runs_by_status( array( 'running', 'failed', 'interrupted' ) );

		return empty( $runs ) ? null : $runs[0];
	}

	/**
	 * Provider, built when a step first needs it.
	 *
	 * @return MollieSettlementProvider
	 * @throws SettlementProviderException When Mollie is not connected.
	 */
	private function provider() {
		if ( null === $this->provider ) {
			$this->provider = new MollieSettlementProvider();
		}

		return $this->provider;
	}

	/**
	 * Build the allowlisted REST shape of a run.
	 *
	 * @param array $run Run row.
	 * @return array
	 */
	public static function prepare_for_response( array $run ) {
		$state      = (array) json_decode( (string) $run['state'], true );
		$messages   = self::error_messages();
		$error_code = $run['error_code'] ? (string) $run['error_code'] : null;
		$current    = $state['current'] ?? null;

		return array(
			'id'            => (int) $run['id'],
			'kind'          => (string) $run['kind'],
			'status'        => (string) $run['status'],
			'resumable'     => in_array( $run['status'], array( 'failed', 'interrupted' ), true ),
			'account_id'    => (int) $run['account_id'],
			'settlement_id' => $run['settlement_id'] ? (int) $run['settlement_id'] : null,
			'progress'      => array(
				'settlements_done'   => (int) $run['settlements_done'],
				'settlements_queued' => count( (array) ( $state['queue'] ?? array() ) ) + ( $current ? 1 : 0 ),
				'listing_done'       => ! empty( $state['list_done'] ),
				'requests_done'      => (int) $run['requests_done'],
				'current_part'       => $current ? ( MollieSettlementProvider::PARTS[ (int) $current['part'] ] ?? null ) : null,
			),
			'error_code'    => $error_code,
			'error_message' => $error_code ? ( $messages[ $error_code ] ?? $messages['mollie_request_failed'] ) : null,
			'started_at'    => get_date_from_gmt( $run['started_at'] ),
			'updated_at'    => get_date_from_gmt( $run['updated_at'] ),
			'finished_at'   => $run['finished_at'] ? get_date_from_gmt( $run['finished_at'] ) : null,
		);
	}

	/**
	 * Error returned while another import is active.
	 *
	 * @param array|null $running The active run, when known.
	 * @return WP_Error
	 */
	private static function busy_error( $running ) {
		return new WP_Error(
			'settlement_import_in_progress',
			__( 'Another settlement import is still running. Wait for it to finish, then try again.', 'fair-payments-connector' ),
			array(
				'status' => 409,
				'run'    => $running ? self::prepare_for_response( $running ) : null,
			)
		);
	}
}
