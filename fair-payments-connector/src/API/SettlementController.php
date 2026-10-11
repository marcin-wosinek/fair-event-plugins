<?php
/**
 * REST API Controller for saved Mollie settlements
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Database\SettlementRepository;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use FairPaymentsConnector\Services\SettlementApiImport;
use FairPaymentsConnector\Services\SettlementStore;
use FairPaymentsConnector\Services\SettlementView;
use FairPaymentsConnector\Settlements\CsvParser;
use FairPaymentsConnector\Settlements\CsvValidationException;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Lists saved settlements and imports them from Mollie or a CSV export (#1694).
 *
 * Admin-only. Reading saved settlements and importing a CSV never contact
 * Mollie; only the import routes do.
 */
class SettlementController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$id_arg = array(
			'id' => array(
				'type'              => 'integer',
				'required'          => true,
				'sanitize_callback' => 'absint',
			),
		);

		$csv_args = array(
			'account_id'      => array(
				'type'              => 'integer',
				'default'           => 0,
				'sanitize_callback' => 'absint',
			),
			'account_label'   => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'confirm_account' => array(
				'type'    => 'boolean',
				'default' => false,
			),
		);

		register_rest_route(
			$this->namespace,
			'/settlements',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						// An explicit sanitize_callback switches off core's
						// schema check, so it is asked for by name.
						'page'       => array(
							'type'              => 'integer',
							'default'           => 1,
							'minimum'           => 1,
							'validate_callback' => 'rest_validate_request_arg',
							'sanitize_callback' => 'absint',
						),
						'per_page'   => array(
							'type'              => 'integer',
							'default'           => 20,
							'minimum'           => 1,
							'maximum'           => 100,
							'validate_callback' => 'rest_validate_request_arg',
							'sanitize_callback' => 'absint',
						),
						'account_id' => array(
							'type'              => 'integer',
							'default'           => 0,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/settlements/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $id_arg,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/settlements/accounts',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_accounts' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/settlements/accounts/(?P<id>\d+)/confirm',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'confirm_account' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array_merge(
						$id_arg,
						array(
							'organization_id' => array(
								'type'              => 'string',
								'required'          => true,
								'pattern'           => '^[A-Za-z0-9_]{1,64}$',
								'validate_callback' => 'rest_validate_request_arg',
								'sanitize_callback' => 'sanitize_text_field',
							),
						)
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/settlements/csv/validate',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'validate_csv' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $csv_args,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/settlements/csv/import',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_csv' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $csv_args,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/settlements/imports',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_import' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'start_import' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'kind'          => array(
							'type'     => 'string',
							'required' => true,
							'enum'     => array( SettlementApiImport::KIND_HISTORY, SettlementApiImport::KIND_REFRESH ),
						),
						'settlement_id' => array(
							'type'              => 'integer',
							'default'           => 0,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/settlements/imports/(?P<id>\d+)/step',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'step_import' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $id_arg,
				),
			)
		);
	}

	/**
	 * Capability check for every route.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * GET /settlements — saved settlements, most recent payout first.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$page       = (int) $request->get_param( 'page' );
		$per_page   = (int) $request->get_param( 'per_page' );
		$account_id = (int) $request->get_param( 'account_id' );
		$repository = new SettlementRepository();
		$view       = new SettlementView( $repository );
		$result     = $repository->get_settlements_page( $page, $per_page, $account_id ? $account_id : null );

		return new WP_REST_Response(
			array(
				'items' => array_map( array( $view, 'summary' ), $result['items'] ),
				'total' => $result['total'],
				'pages' => (int) ceil( $result['total'] / $per_page ),
				'page'  => $page,
			),
			200
		);
	}

	/**
	 * GET /settlements/{id} — one saved settlement with its movements.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		$repository = new SettlementRepository();
		$settlement = $repository->get_settlement( (int) $request->get_param( 'id' ) );

		if ( ! $settlement ) {
			return new WP_Error( 'settlement_not_found', __( 'Settlement not found.', 'fair-payments-connector' ), array( 'status' => 404 ) );
		}

		return new WP_REST_Response( ( new SettlementView( $repository ) )->detail( $settlement ), 200 );
	}

	/**
	 * GET /settlements/accounts — accounts, plus what the Mollie connection allows.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_accounts( $request ) {
		$problem  = SettlementApiImport::access_problem();
		$messages = SettlementApiImport::error_messages();

		return new WP_REST_Response(
			array(
				'accounts'   => array_map( array( SettlementView::class, 'account' ), ( new SettlementRepository() )->get_accounts() ),
				'connection' => array(
					'connected'       => MolliePaymentHandler::is_configured(),
					'organization_id' => SettlementApiImport::connected_organization(),
					'can_import'      => null === $problem,
					'problem'         => $problem,
					'problem_message' => null === $problem ? null : $messages[ $problem ],
				),
			),
			200
		);
	}

	/**
	 * POST /settlements/accounts/{id}/confirm — confirm that an account named
	 * during a CSV upload is the connected Mollie organization.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function confirm_account( $request ) {
		$organization = SettlementApiImport::connected_organization();

		if ( ! MolliePaymentHandler::is_configured() || '' === $organization ) {
			return new WP_Error(
				'mollie_not_connected',
				__( 'Connect Mollie before confirming which organization an account belongs to.', 'fair-payments-connector' ),
				array( 'status' => 409 )
			);
		}

		if ( $organization !== (string) $request->get_param( 'organization_id' ) ) {
			return new WP_Error(
				'settlement_account_mismatch',
				__( 'An account can only be confirmed as the Mollie organization that is currently connected.', 'fair-payments-connector' ),
				array( 'status' => 409 )
			);
		}

		$account = ( new SettlementStore() )->confirm_account( (int) $request->get_param( 'id' ), $organization );
		if ( is_wp_error( $account ) ) {
			return $account;
		}

		return new WP_REST_Response( array( 'account' => SettlementView::account( $account ) ), 200 );
	}

	/**
	 * POST /settlements/csv/validate — check a file and say what importing it would do.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function validate_csv( $request ) {
		return $this->handle_csv( $request, false );
	}

	/**
	 * POST /settlements/csv/import — validate a file again and save it.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function import_csv( $request ) {
		return $this->handle_csv( $request, true );
	}

	/**
	 * Validate an uploaded settlement CSV and optionally save it.
	 *
	 * The upload is read from PHP's temporary file and never stored.
	 *
	 * @param WP_REST_Request $request Request.
	 * @param bool            $commit  Save the settlement.
	 * @return WP_REST_Response|WP_Error
	 */
	private function handle_csv( $request, $commit ) {
		$files = $request->get_file_params();
		$file  = $files['file'] ?? null;

		if ( ! is_array( $file ) || empty( $file['tmp_name'] ) || ! empty( $file['error'] ) || ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'settlement_csv_missing', __( 'Choose a settlement CSV file to upload.', 'fair-payments-connector' ), array( 'status' => 400 ) );
		}

		if ( (int) $file['size'] > CsvParser::MAX_BYTES ) {
			return self::csv_error(
				array(
					array(
						'code'    => 'csv_too_large',
						'message' => __( 'The file is larger than 2 MB. Export one settlement at a time.', 'fair-payments-connector' ),
						'row'     => null,
					),
				)
			);
		}

		try {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local PHP upload, read once and not kept.
			$parsed = CsvParser::parse( (string) file_get_contents( $file['tmp_name'] ) );
		} catch ( CsvValidationException $e ) {
			return self::csv_error( $e->get_errors() );
		}

		$repository = new SettlementRepository();
		$account    = null;
		$account_id = (int) $request->get_param( 'account_id' );
		$label      = substr( trim( (string) $request->get_param( 'account_label' ) ), 0, 191 );

		if ( $account_id ) {
			$account = $repository->get_account( $account_id );
			if ( ! $account ) {
				return new WP_Error( 'settlement_account_not_found', __( 'Account not found.', 'fair-payments-connector' ), array( 'status' => 404 ) );
			}
		}

		// A file does not say which Mollie organization it came from, so
		// adding it to a confirmed organization takes an explicit statement.
		$needs_confirmation = $account && (int) $account['verified'];

		if ( $commit ) {
			if ( ! $account && '' === $label ) {
				return new WP_Error(
					'settlement_account_required',
					__( 'Choose the account this settlement belongs to, or name a new one.', 'fair-payments-connector' ),
					array( 'status' => 400 )
				);
			}
			if ( $needs_confirmation && true !== $request->get_param( 'confirm_account' ) ) {
				return new WP_Error(
					'settlement_account_confirmation_required',
					__( 'Confirm that this file was exported from the selected Mollie organization.', 'fair-payments-connector' ),
					array( 'status' => 400 )
				);
			}
		}

		$result = ( new SettlementStore( $repository ) )->import_csv( $parsed, $account, $label, $commit );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response(
			array(
				'imported'            => $commit && in_array( $result['outcome'], array( 'new', 'attach' ), true ),
				'outcome'             => $result['outcome'],
				'settlement_id'       => $result['settlement_id'],
				'requires_confirming' => (bool) $needs_confirmation,
				'format'              => $parsed['format'],
				'reference'           => $parsed['facts']['reference'],
				'currency'            => $parsed['facts']['currency'],
				'movement_count'      => count( $parsed['movements'] ),
				'totals'              => $parsed['totals'],
			),
			$commit && 'new' === $result['outcome'] ? 201 : 200
		);
	}

	/**
	 * Error for a file that cannot be imported as it is.
	 *
	 * @param array[] $errors Problems found.
	 * @return WP_Error
	 */
	private static function csv_error( array $errors ) {
		return new WP_Error(
			'settlement_csv_invalid',
			__( 'The file could not be imported. Nothing was saved.', 'fair-payments-connector' ),
			array(
				'status' => 400,
				'errors' => $errors,
			)
		);
	}

	/**
	 * GET /settlements/imports — the import that is running or can be continued.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_import( $request ) {
		$run = ( new SettlementApiImport() )->get_open_run();

		return new WP_REST_Response( array( 'run' => $run ? SettlementApiImport::prepare_for_response( $run ) : null ), 200 );
	}

	/**
	 * POST /settlements/imports — start loading from Mollie.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function start_import( $request ) {
		$kind          = (string) $request->get_param( 'kind' );
		$settlement_id = (int) $request->get_param( 'settlement_id' );

		if ( SettlementApiImport::KIND_REFRESH === $kind && ! $settlement_id ) {
			return new WP_Error( 'settlement_required', __( 'Choose the settlement to refresh.', 'fair-payments-connector' ), array( 'status' => 400 ) );
		}

		$run = ( new SettlementApiImport() )->start( $kind, $settlement_id ? $settlement_id : null, get_current_user_id() );
		if ( is_wp_error( $run ) ) {
			return $run;
		}

		return new WP_REST_Response( array( 'run' => SettlementApiImport::prepare_for_response( $run ) ), 201 );
	}

	/**
	 * POST /settlements/imports/{id}/step — make the next Mollie request of
	 * an import, continuing it when it had stopped.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function step_import( $request ) {
		$run = ( new SettlementApiImport() )->step( (int) $request->get_param( 'id' ) );
		if ( is_wp_error( $run ) ) {
			return $run;
		}

		return new WP_REST_Response( array( 'run' => SettlementApiImport::prepare_for_response( $run ) ), 200 );
	}
}
