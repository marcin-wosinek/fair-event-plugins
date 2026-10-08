<?php
/**
 * REST API Controller for Transactions
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Database\ExternalUpdateRunRepository;
use FairPaymentsConnector\Models\Transaction;
use FairPaymentsConnector\Models\LineItem;
use FairPaymentsConnector\Models\EntryTransaction;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Services\ExternalUpdateRuns;
use FairPaymentsConnector\Services\TransactionDeletionService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles transaction REST API endpoints
 */
class TransactionsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register the routes for transactions
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/transactions',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id'             => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'participant_id' => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'user_id'        => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'post_id'        => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'event_date_id'  => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/import',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'transactions' => array(
							'type'     => 'array',
							'required' => true,
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/mollie',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_mollie_payments' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_mollie_args(),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_mollie_payments' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array_merge(
						$this->get_mollie_args(),
						array(
							'payment_ids' => array(
								'type'     => 'array',
								'required' => true,
								'minItems' => 1,
								'maxItems' => 50,
								'items'    => array(
									'type'    => 'string',
									'pattern' => '^tr_[A-Za-z0-9]+$',
								),
							),
							'run_id'      => $this->get_run_id_arg(),
						)
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/missing-mollie-fee',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_missing_mollie_fee_ids' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'mode' => array(
							'type'              => 'string',
							'default'           => '',
							'enum'              => array( '', 'live', 'test' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/(?P<id>\d+)/sync-mollie',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'sync_mollie' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/sync-mollie-batch',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'sync_mollie_batch' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'ids'    => array(
							'type'              => 'array',
							'required'          => true,
							'minItems'          => 1,
							'maxItems'          => 25,
							'items'             => array(
								'type' => 'integer',
							),
							// WP_REST_Request::has_valid_params() only runs a
							// validate_callback when one is explicitly set — the
							// minItems/maxItems/items schema above is otherwise
							// never enforced, so validate the bounds here too.
							'validate_callback' => function ( $ids ) {
								if ( ! is_array( $ids ) || count( $ids ) < 1 || count( $ids ) > 25 ) {
									return new WP_Error(
										'invalid_ids',
										__( 'Provide between 1 and 25 transaction ids.', 'fair-payments-connector' ),
										array( 'status' => 400 )
									);
								}
								return true;
							},
							'sanitize_callback' => function ( $ids ) {
								return array_map( 'absint', (array) $ids );
							},
						),
						'run_id' => $this->get_run_id_arg(),
					),
				),
			)
		);
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get a collection of transactions
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$per_page = $request->get_param( 'per_page' ) ?? 50;
		$page     = $request->get_param( 'page' ) ?? 1;
		$offset   = ( $page - 1 ) * $per_page;

		$criteria = $this->get_list_criteria( $request );
		if ( is_wp_error( $criteria ) ) {
			return $criteria;
		}

		// The list and its total share one set of criteria.
		$transactions = Transaction::get_all(
			array_merge(
				$criteria,
				array(
					'limit'   => $per_page,
					'offset'  => $offset,
					'orderby' => $request->get_param( 'orderby' ) ?? 'created_at',
					'order'   => $request->get_param( 'order' ) ?? 'DESC',
				)
			)
		);
		$total        = Transaction::count( $criteria );

		$transaction_ids  = array_map(
			function ( $t ) {
				return (int) $t->id;
			},
			$transactions
		);
		$entry_ids_by_txn = EntryTransaction::get_entry_ids_for_transactions( $transaction_ids );

		$data = array();
		foreach ( $transactions as $transaction ) {
			$user_name = '';
			if ( $transaction->user_id ) {
				$user = get_userdata( $transaction->user_id );
				if ( $user ) {
					$user_name = $user->display_name;
				}
			}

			$participant_id = isset( $transaction->participant_id ) && $transaction->participant_id
				? (int) $transaction->participant_id
				: null;
			$participant    = apply_filters( 'fair_payment_prepare_participant', null, $participant_id );

			$event_url = '';
			if ( $transaction->event_date_id && class_exists( '\\FairEvents\\Models\\EventDates' ) ) {
				$event_date = \FairEvents\Models\EventDates::get_by_id( (int) $transaction->event_date_id );
				if ( $event_date && ! empty( $event_date->event_id ) ) {
					$permalink = get_permalink( (int) $event_date->event_id );
					if ( $permalink ) {
						$event_url = $permalink;
					}
				}
			}

			$data[] = array(
				'id'                => (int) $transaction->id,
				'mollie_payment_id' => $transaction->mollie_payment_id ?? '',
				'event_date_id'     => $transaction->event_date_id ? (int) $transaction->event_date_id : null,
				'event_url'         => $event_url,
				'amount'            => (float) ( $transaction->amount ?? 0 ),
				'currency'          => $transaction->currency ?? 'EUR',
				'mollie_fee'        => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
				'application_fee'   => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
				'status'            => $transaction->status ?? 'unknown',
				'testmode'          => ! empty( $transaction->testmode ),
				'description'       => $transaction->description ?? '',
				'user_name'         => $user_name,
				'participant_id'    => $participant_id,
				'participant'       => $participant,
				'entry_ids'         => $entry_ids_by_txn[ (int) $transaction->id ] ?? array(),
				'created_at'        => $transaction->created_at ? get_date_from_gmt( $transaction->created_at ) : '',
			);
		}

		return new WP_REST_Response(
			array(
				'transactions' => $data,
				'total'        => $total,
				'pages'        => ceil( $total / $per_page ),
				'page'         => (int) $page,
			),
			200
		);
	}

	/**
	 * Normalize the list filters into the criteria shared by the list and
	 * count queries.
	 *
	 * Dates are inclusive calendar days in the site timezone, converted to
	 * UTC boundaries for the stored `created_at`; the upper bound is the
	 * following local midnight, exclusive. Amounts are inclusive and compared
	 * as recorded, across currencies.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return array|WP_Error Criteria for Transaction::get_all()/count(), or a 400 error for a reversed range.
	 */
	private function get_list_criteria( $request ) {
		$date_from  = (string) $request->get_param( 'date_from' );
		$date_to    = (string) $request->get_param( 'date_to' );
		$amount_min = (string) $request->get_param( 'amount_min' );
		$amount_max = (string) $request->get_param( 'amount_max' );

		if ( '' !== $date_from && '' !== $date_to && $date_from > $date_to ) {
			return new WP_Error(
				'invalid_date_range',
				__( 'The start date must be on or before the end date.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		if ( '' !== $amount_min && '' !== $amount_max && (float) $amount_min > (float) $amount_max ) {
			return new WP_Error(
				'invalid_amount_range',
				__( 'The minimum amount must not be greater than the maximum amount.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$timezone = wp_timezone();
		$utc      = new \DateTimeZone( 'UTC' );
		$criteria = array(
			'status'        => $request->get_param( 'status' ) ?? '',
			'mode'          => $request->get_param( 'mode' ) ?? '',
			'event_date_id' => $request->get_param( 'event_date_id' ) ?? 0,
			'search'        => (string) $request->get_param( 'search' ),
			'amount_min'    => $amount_min,
			'amount_max'    => $amount_max,
		);

		if ( '' !== $date_from ) {
			$criteria['date_from'] = ( new \DateTimeImmutable( $date_from . ' 00:00:00', $timezone ) )
				->setTimezone( $utc )
				->format( 'Y-m-d H:i:s' );
		}

		if ( '' !== $date_to ) {
			$criteria['date_before'] = ( new \DateTimeImmutable( $date_to . ' 00:00:00', $timezone ) )
				->modify( '+1 day' )
				->setTimezone( $utc )
				->format( 'Y-m-d H:i:s' );
		}

		return $criteria;
	}

	/**
	 * Get a single transaction
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		// Sync with Mollie to capture missing fee or update pending status.
		$transaction = TransactionAPI::sync_transaction_status( $request->get_param( 'id' ) );

		if ( ! $transaction ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->prepare_transaction_response( $transaction ), 200 );
	}

	/**
	 * Update editable fields on a transaction.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$transaction = Transaction::get_by_id( $request->get_param( 'id' ) );

		if ( ! $transaction ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		$fields = array();

		if ( null !== $request->get_param( 'participant_id' ) ) {
			$participant_id           = $request->get_param( 'participant_id' );
			$fields['participant_id'] = $participant_id ? $participant_id : null;
		}

		if ( null !== $request->get_param( 'user_id' ) ) {
			$user_id           = $request->get_param( 'user_id' );
			$fields['user_id'] = $user_id ? $user_id : null;
		}

		if ( null !== $request->get_param( 'post_id' ) ) {
			$post_id           = $request->get_param( 'post_id' );
			$fields['post_id'] = $post_id ? $post_id : null;
		}

		if ( null !== $request->get_param( 'event_date_id' ) ) {
			$event_date_id = $request->get_param( 'event_date_id' );
			if ( $event_date_id && ! apply_filters( 'fair_payment_validate_event_date_id', false, $event_date_id ) ) {
				return new WP_Error(
					'invalid_event_date',
					__( 'The selected event date does not exist.', 'fair-payments-connector' ),
					array( 'status' => 400 )
				);
			}
			$fields['event_date_id'] = $event_date_id ? $event_date_id : null;
		}

		if ( empty( $fields ) ) {
			return new WP_Error(
				'no_fields',
				__( 'No fields to update.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$updated = Transaction::update_fields( (int) $transaction->id, $fields );

		if ( ! $updated ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update transaction.', 'fair-payments-connector' ),
				array( 'status' => 500 )
			);
		}

		$transaction = Transaction::get_by_id( (int) $transaction->id );

		return new WP_REST_Response( $this->prepare_transaction_response( $transaction ), 200 );
	}

	/**
	 * Permanently delete a local transaction and its owned local data.
	 *
	 * Never cancels, refunds, or otherwise modifies the payment in Mollie or
	 * any other external service — only local WordPress data is removed.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		if ( ! Transaction::get_by_id( $id ) ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		if ( ! TransactionDeletionService::delete( $id ) ) {
			return new WP_Error(
				'delete_failed',
				__( 'Failed to delete the transaction. It has not been changed.', 'fair-payments-connector' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'id'      => $id,
			),
			200
		);
	}

	/**
	 * Import transactions from an exported JSON payload.
	 *
	 * Creates new rows or updates existing ones matched by mollie_payment_id.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function import_items( $request ) {
		$transactions = $request->get_param( 'transactions' );

		if ( ! is_array( $transactions ) ) {
			return new WP_Error(
				'invalid_payload',
				__( 'Expected an array of transactions.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$created = 0;
		$updated = 0;
		$skipped = 0;

		foreach ( $transactions as $transaction ) {
			if ( ! is_array( $transaction ) ) {
				++$skipped;
				continue;
			}

			$result = Transaction::import( $transaction );

			if ( 'created' === $result ) {
				++$created;
			} elseif ( 'updated' === $result ) {
				++$updated;
			} else {
				++$skipped;
			}
		}

		return new WP_REST_Response(
			array(
				'created' => $created,
				'updated' => $updated,
				'skipped' => $skipped,
				'message' => sprintf(
					/* translators: 1: created count, 2: updated count, 3: skipped count */
					__( 'Imported %1$d new, updated %2$d, skipped %3$d transaction(s).', 'fair-payments-connector' ),
					$created,
					$updated,
					$skipped
				),
			),
			200
		);
	}

	/**
	 * List eligible Mollie payments.
	 *
	 * @param WP_REST_Request $request Full request data.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_mollie_payments( $request ) {
		if ( ! in_array( $request['mode'], array( 'live', 'test' ), true ) ) {
			return new WP_Error( 'invalid_mode', __( 'Choose live or test mode.', 'fair-payments-connector' ), array( 'status' => 400 ) );
		}
		if ( ! MolliePaymentHandler::is_configured() ) {
			return new WP_REST_Response( $this->mollie_connection_state(), 200 );
		}

		$date_error = $this->validate_mollie_dates( $request );
		if ( is_wp_error( $date_error ) ) {
			return $date_error;
		}

		try {
			$handler = new MolliePaymentHandler();
			$page    = $handler->list_payments( $request['from'], (int) $request['limit'], 'test' === $request['mode'] );
			$rows    = array();
			$oldest  = false;
			$last_id = null;
			foreach ( $page as $payment ) {
				$last_id = $payment->id;
				// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
				$created = strtotime( $payment->createdAt );
				if ( $created < strtotime( $request['start_date'] . ' 00:00:00 UTC' ) ) {
					$oldest = true;
					break;
				}
				if ( 'paid' !== $payment->status || $created > strtotime( $request['end_date'] . ' 23:59:59 UTC' ) ) {
					continue;
				}
				$row                     = $handler->map_payment_for_import( $payment );
				$row['already_imported'] = (bool) Transaction::get_by_mollie_id( $payment->id );
				$rows[]                  = $row;
			}
			$next = ( ! $oldest && $page->hasNext() ) ? $last_id : null;
			return new WP_REST_Response(
				array_merge(
					$this->mollie_connection_state(),
					array(
						'payments'      => $rows,
						'next'          => $next,
						'limit_reached' => (bool) $next,
					)
				),
				200
			);
		} catch ( \Exception $e ) {
			return new WP_Error( 'mollie_api_error', __( 'Mollie payments could not be loaded. Please try again.', 'fair-payments-connector' ), array( 'status' => 502 ) );
		}
	}

	/**
	 * Import selected payments after re-fetching them from Mollie.
	 *
	 * @param WP_REST_Request $request Full request data.
	 * @return WP_REST_Response|WP_Error
	 * @throws \Exception When the Mollie client cannot be initialized.
	 */
	public function import_mollie_payments( $request ) {
		$run_id = (int) $request->get_param( 'run_id' );
		if ( $run_id ) {
			$run = ExternalUpdateRuns::claim( $run_id, ExternalUpdateRuns::ACTION_IMPORT_MOLLIE_PAYMENTS, (string) $request['mode'] );
			if ( is_wp_error( $run ) ) {
				return $run;
			}
		}

		if ( ! in_array( $request['mode'], array( 'live', 'test' ), true ) ) {
			return $this->fail_run( $run_id, 'invalid_request', new WP_Error( 'invalid_mode', __( 'Choose live or test mode.', 'fair-payments-connector' ), array( 'status' => 400 ) ) );
		}
		$date_error = $this->validate_mollie_dates( $request );
		if ( is_wp_error( $date_error ) ) {
			return $this->fail_run( $run_id, 'invalid_request', $date_error );
		}
		if ( ! MolliePaymentHandler::is_configured() ) {
			return $this->fail_run(
				$run_id,
				'mollie_not_connected',
				new WP_Error(
					'mollie_not_connected',
					__( 'Connect Mollie before importing payments.', 'fair-payments-connector' ),
					array(
						'status'       => 400,
						'settings_url' => $this->mollie_connection_state()['settings_url'],
					)
				)
			);
		}
		$handler = new MolliePaymentHandler();
		$result  = array(
			'imported' => 0,
			'skipped'  => 0,
			'failed'   => 0,
			'failures' => array(),
		);
		foreach ( array_unique( $request['payment_ids'] ) as $payment_id ) {
			try {
				$payment = $handler->get_payment( $payment_id, array( 'testmode' => 'test' === $request['mode'] ) );
				if ( 'paid' !== $payment->status || $payment->mode !== $request['mode'] ) {
					throw new \Exception( 'ineligible' );
				}
				$state = Transaction::import_mollie_create_only( $handler->map_payment_for_import( $payment ) );
				if ( 'created' === $state ) {
					++$result['imported'];
					$this->record_run( $run_id, array( 'created' => 1 ) );
				} elseif ( 'existing' === $state ) {
					++$result['skipped'];
					$this->record_run( $run_id, array( 'skipped' => 1 ) );
				} else {
					throw new \Exception( 'insert_failed' );
				}
			} catch ( \Exception $e ) {
				++$result['failed'];
				$result['failures'][] = array(
					'payment_id' => $payment_id,
					'message'    => __( 'This payment could not be imported.', 'fair-payments-connector' ),
				);
				$this->record_run( $run_id, array( 'failed' => 1 ) );
			}
		}
		$result['message'] = sprintf(
			/* translators: 1: imported count, 2: skipped count, 3: failed count. */
			__( 'Imported %1$d, skipped %2$d, and failed %3$d payment(s).', 'fair-payments-connector' ),
			$result['imported'],
			$result['skipped'],
			$result['failed']
		);
		if ( $run_id ) {
			$result['run'] = ExternalUpdateRuns::prepare_for_response( ExternalUpdateRuns::finish( $run_id ) );
		}
		return new WP_REST_Response( $result, 200 );
	}

	/**
	 * Shared `run_id` argument for actions started from External Updates.
	 *
	 * @return array
	 */
	private function get_run_id_arg() {
		return array(
			'description'       => __( 'External Updates run this request belongs to.', 'fair-payments-connector' ),
			'type'              => 'integer',
			'default'           => 0,
			'minimum'           => 0,
			'sanitize_callback' => 'absint',
		);
	}

	/**
	 * Record progress on a run, when the request belongs to one.
	 *
	 * @param int   $run_id Run ID, or 0.
	 * @param array $counts Count deltas.
	 * @return void
	 */
	private function record_run( $run_id, array $counts ) {
		if ( $run_id ) {
			ExternalUpdateRuns::record( $run_id, $counts );
		}
	}

	/**
	 * Close a run as failed before any work, then return the request error.
	 *
	 * @param int      $run_id     Run ID, or 0.
	 * @param string   $error_code Safe failure category.
	 * @param WP_Error $error      Error to return.
	 * @return WP_Error
	 */
	private function fail_run( $run_id, $error_code, WP_Error $error ) {
		if ( $run_id ) {
			$run = ExternalUpdateRuns::finish( $run_id, $error_code );
			$error->add_data( array_merge( (array) $error->get_error_data(), array( 'run' => ExternalUpdateRuns::prepare_for_response( $run ) ) ) );
		}
		return $error;
	}

	/** Return safe Mollie connection details for the browser. */
	private function mollie_connection_state() {
		return array(
			'connected'    => MolliePaymentHandler::is_configured(),
			'default_mode' => get_option( 'fair_payment_mode', 'test' ),
			'settings_url' => add_query_arg( 'page', 'fair-payments-connector-settings', admin_url( 'admin.php' ) ),
		);
	}

	/**
	 * Validate the bounded date range.
	 *
	 * @param WP_REST_Request $request Full request data.
	 * @return true|WP_Error
	 */
	private function validate_mollie_dates( $request ) {
		$start = strtotime( $request['start_date'] . ' 00:00:00 UTC' );
		$end   = strtotime( $request['end_date'] . ' 23:59:59 UTC' );
		if ( false === $start || false === $end || $start > $end || ( $end - $start ) > 90 * DAY_IN_SECONDS ) {
			return new WP_Error( 'invalid_date_range', __( 'Choose a valid date range of no more than 90 days.', 'fair-payments-connector' ), array( 'status' => 400 ) );
		}
		return true;
	}

	/** Return the shared Mollie route arguments. */
	private function get_mollie_args() {
		return array(
			'mode'       => array(
				'type'              => 'string',
				'required'          => true,
				'enum'              => array( 'live', 'test' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'start_date' => array(
				'type'              => 'string',
				'required'          => true,
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'end_date'   => array(
				'type'              => 'string',
				'required'          => true,
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'from'       => array(
				'type'              => 'string',
				'default'           => '',
				'pattern'           => '^(|tr_[A-Za-z0-9]+)$',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'limit'      => array(
				'type'              => 'integer',
				'default'           => 25,
				'minimum'           => 1,
				'maximum'           => 50,
				'sanitize_callback' => 'absint',
			),
		);
	}

	/**
	 * List IDs of paid transactions missing Mollie fee data.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_missing_mollie_fee_ids( $request ) {
		$ids = Transaction::get_ids_missing_mollie_fee( (string) $request->get_param( 'mode' ) );

		return new WP_REST_Response(
			array(
				'ids'   => $ids,
				'total' => count( $ids ),
			),
			200
		);
	}

	/**
	 * Force a Mollie sync for a transaction to refresh status and fee data.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function sync_mollie( $request ) {
		$result = TransactionAPI::sync_transaction_status( $request->get_param( 'id' ), true );

		if ( null === $result ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		if ( is_wp_error( $result ) ) {
			$result->add_data( array( 'status' => 400 ) );
			return $result;
		}

		return new WP_REST_Response( $this->prepare_transaction_response( $result ), 200 );
	}

	/**
	 * Force a Mollie sync for a batch of transactions.
	 *
	 * Every id is attempted independently: one failure never stops the rest
	 * of the batch. A per-id outcome is data, not a request error, so this
	 * always returns 200 with the tallied counts.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function sync_mollie_batch( $request ) {
		$run_id = (int) $request->get_param( 'run_id' );
		if ( $run_id ) {
			$run = ExternalUpdateRuns::claim( $run_id, ExternalUpdateRuns::ACTION_LOAD_MISSING_FEES );
			if ( is_wp_error( $run ) ) {
				return $run;
			}
		}

		$ids = array_unique( (array) $request->get_param( 'ids' ) );

		$updated = 0;
		$failed  = 0;

		foreach ( $ids as $id ) {
			$result = TransactionAPI::sync_transaction_status( (int) $id, true );

			if ( $result && ! is_wp_error( $result ) && null !== $result->mollie_fee ) {
				++$updated;
			} else {
				++$failed;
			}
		}

		$response = array(
			'processed' => count( $ids ),
			'updated'   => $updated,
			'failed'    => $failed,
		);

		if ( $run_id ) {
			ExternalUpdateRuns::record(
				$run_id,
				array(
					'updated' => $updated,
					'failed'  => $failed,
				)
			);
			$response['run'] = ExternalUpdateRuns::prepare_for_response( ( new ExternalUpdateRunRepository() )->get( $run_id ) );
		}

		return new WP_REST_Response( $response, 200 );
	}

	/**
	 * Build the REST response payload for a transaction row.
	 *
	 * @param object $transaction Transaction record from the DB.
	 * @return array
	 */
	private function prepare_transaction_response( $transaction ) {
		$user_name = '';
		if ( $transaction->user_id ) {
			$user = get_userdata( $transaction->user_id );
			if ( $user ) {
				$user_name = $user->display_name;
			}
		}

		$post_title = '';
		if ( $transaction->post_id ) {
			$post = get_post( $transaction->post_id );
			if ( $post ) {
				$post_title = $post->post_title;
			}
		}

		$metadata = $transaction->metadata ?? '';
		if ( is_string( $metadata ) && '' !== $metadata ) {
			$decoded  = json_decode( $metadata );
			$metadata = ( null !== $decoded ) ? $decoded : $metadata;
		}

		$line_items     = LineItem::get_by_transaction_id( $transaction->id );
		$line_item_data = array();
		foreach ( $line_items as $item ) {
			$line_item_data[] = array(
				'id'           => (int) $item->id,
				'name'         => $item->name,
				'description'  => $item->description ?? '',
				'quantity'     => (int) $item->quantity,
				'unit_amount'  => (float) $item->unit_amount,
				'total_amount' => (float) $item->total_amount,
			);
		}

		$participant_id = isset( $transaction->participant_id ) && $transaction->participant_id
			? (int) $transaction->participant_id
			: null;
		$participant    = apply_filters( 'fair_payment_prepare_participant', null, $participant_id );

		$event_date_id = $transaction->event_date_id ? (int) $transaction->event_date_id : null;
		$event         = apply_filters( 'fair_payment_prepare_event', null, $event_date_id );

		$data = array(
			'id'                   => (int) $transaction->id,
			'mollie_payment_id'    => $transaction->mollie_payment_id ?? '',
			'post_id'              => $transaction->post_id ? (int) $transaction->post_id : null,
			'event_date_id'        => $event_date_id,
			'event'                => $event,
			'post_title'           => $post_title,
			'user_id'              => $transaction->user_id ? (int) $transaction->user_id : null,
			'user_name'            => $user_name,
			'participant_id'       => $participant_id,
			'participant'          => $participant,
			'amount'               => (float) ( $transaction->amount ?? 0 ),
			'currency'             => $transaction->currency ?? 'EUR',
			'mollie_fee'           => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
			'application_fee'      => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
			'status'               => $transaction->status ?? 'unknown',
			'testmode'             => ! empty( $transaction->testmode ),
			'description'          => $transaction->description ?? '',
			'redirect_url'         => $transaction->redirect_url ?? '',
			'webhook_url'          => $transaction->webhook_url ?? '',
			'checkout_url'         => $transaction->checkout_url ?? '',
			'metadata'             => $metadata,
			'created_at'           => $transaction->created_at ? get_date_from_gmt( $transaction->created_at ) : '',
			'payment_initiated_at' => $transaction->payment_initiated_at ? get_date_from_gmt( $transaction->payment_initiated_at ) : '',
			'updated_at'           => $transaction->updated_at ? get_date_from_gmt( $transaction->updated_at ) : '',
			'line_items'           => $line_item_data,
		);

		if ( isset( $transaction->sync_debug ) ) {
			$data['sync_debug'] = $transaction->sync_debug;
		}

		return $data;
	}

	/**
	 * Get collection parameters
	 *
	 * @return array
	 */
	public function get_collection_params() {
		return array(
			'page'          => array(
				'type'              => 'integer',
				'default'           => 1,
				'minimum'           => 1,
				'sanitize_callback' => 'absint',
			),
			'per_page'      => array(
				'type'              => 'integer',
				'default'           => 50,
				'minimum'           => 1,
				'maximum'           => 100,
				'sanitize_callback' => 'absint',
			),
			'status'        => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'mode'          => array(
				'type'              => 'string',
				'default'           => '',
				'enum'              => array( '', 'live', 'test' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'event_date_id' => array(
				'type'              => 'integer',
				'default'           => 0,
				'minimum'           => 0,
				'sanitize_callback' => 'absint',
			),
			'search'        => array(
				'description'       => __( 'Limit results to a transaction ID, Mollie payment ID, description, or person name or email.', 'fair-payments-connector' ),
				'type'              => 'string',
				'default'           => '',
				'validate_callback' => array( $this, 'validate_search' ),
				'sanitize_callback' => array( $this, 'sanitize_search' ),
			),
			'date_from'     => $this->get_date_filter_arg( __( 'Earliest transaction date (YYYY-MM-DD, site timezone, inclusive).', 'fair-payments-connector' ) ),
			'date_to'       => $this->get_date_filter_arg( __( 'Latest transaction date (YYYY-MM-DD, site timezone, inclusive).', 'fair-payments-connector' ) ),
			'amount_min'    => $this->get_amount_filter_arg( __( 'Lowest transaction amount, inclusive, without currency conversion.', 'fair-payments-connector' ) ),
			'amount_max'    => $this->get_amount_filter_arg( __( 'Highest transaction amount, inclusive, without currency conversion.', 'fair-payments-connector' ) ),
			'orderby'       => array(
				'type'              => 'string',
				'default'           => 'created_at',
				'enum'              => array( 'created_at', 'amount', 'status', 'id' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'order'         => array(
				'type'              => 'string',
				'default'           => 'DESC',
				'enum'              => array( 'ASC', 'DESC' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
		);
	}

	/**
	 * Schema for an optional calendar-date filter.
	 *
	 * @param string $description Argument description.
	 * @return array
	 */
	private function get_date_filter_arg( $description ) {
		return array(
			'description'       => $description,
			'type'              => 'string',
			'default'           => '',
			'validate_callback' => array( $this, 'validate_date_filter' ),
			'sanitize_callback' => array( $this, 'sanitize_filter_value' ),
		);
	}

	/**
	 * Schema for an optional amount filter.
	 *
	 * @param string $description Argument description.
	 * @return array
	 */
	private function get_amount_filter_arg( $description ) {
		return array(
			'description'       => $description,
			'type'              => 'string',
			'default'           => '',
			'validate_callback' => array( $this, 'validate_amount_filter' ),
			'sanitize_callback' => array( $this, 'sanitize_filter_value' ),
		);
	}

	/**
	 * Trim a scalar filter value; anything else becomes an empty (unset) filter.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	public function sanitize_filter_value( $value ) {
		return is_scalar( $value ) ? trim( (string) $value ) : '';
	}

	/**
	 * Validate a date filter: empty, or a real calendar date as YYYY-MM-DD.
	 *
	 * @param mixed $value Raw value.
	 * @return true|WP_Error
	 */
	public function validate_date_filter( $value ) {
		$value = is_scalar( $value ) ? trim( (string) $value ) : null;

		if ( '' === $value ) {
			return true;
		}

		if ( null === $value
			|| ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts )
			|| ! checkdate( (int) $parts[2], (int) $parts[3], (int) $parts[1] )
		) {
			return new WP_Error(
				'invalid_date',
				__( 'Enter a valid date as YYYY-MM-DD.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * Validate an amount filter: empty, or a plain non-negative decimal with
	 * at most two decimal places. Rejects signs, exponents and non-finite
	 * values.
	 *
	 * @param mixed $value Raw value.
	 * @return true|WP_Error
	 */
	public function validate_amount_filter( $value ) {
		$value = is_scalar( $value ) ? trim( (string) $value ) : null;

		if ( '' === $value ) {
			return true;
		}

		if ( null === $value || ! preg_match( '/^\d{1,9}(\.\d{1,2})?$/', $value ) ) {
			return new WP_Error(
				'invalid_amount',
				__( 'Enter an amount of zero or more with at most two decimal places.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * Validate the search term.
	 *
	 * @param mixed $value Raw value.
	 * @return true|WP_Error
	 */
	public function validate_search( $value ) {
		if ( ! is_scalar( $value ) || mb_strlen( trim( (string) $value ) ) > 200 ) {
			return new WP_Error(
				'invalid_search',
				__( 'Enter a search of at most 200 characters.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * Normalize the search term without altering literal characters such as
	 * `%` or `_`: it is only ever used as an escaped, prepared LIKE value.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	public function sanitize_search( $value ) {
		$value = wp_check_invalid_utf8( is_scalar( $value ) ? (string) $value : '' );

		return trim( (string) preg_replace( '/[\x00-\x1F\x7F]+/', ' ', $value ) );
	}
}
