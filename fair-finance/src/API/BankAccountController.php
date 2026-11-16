<?php
/**
 * REST API Controller for bank accounts
 *
 * @package FairFinance
 */

namespace FairFinance\API;

defined( 'WPINC' ) || die;

use FairFinance\Models\BankAccount;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Lists and creates the bank accounts that imports can reference.
 *
 * Accounts are identities only (ID and display name). Renaming and deleting
 * them is out of scope: an import's account is fixed once recorded.
 */
class BankAccountController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-finance/v1';

	/**
	 * Register the routes for bank accounts
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-finance/v1/bank-accounts - List bank accounts.
		// POST /fair-finance/v1/bank-accounts - Create a bank account.
		register_rest_route(
			$this->namespace,
			'/bank-accounts',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'name' => array(
							'description' => __( 'Display name of the bank account.', 'fair-finance' ),
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * List bank accounts
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		return new WP_REST_Response(
			array_map(
				static function ( $account ) {
					return $account->to_array();
				},
				BankAccount::get_all()
			),
			200
		);
	}

	/**
	 * Create a bank account
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$name = trim( sanitize_text_field( (string) $request->get_param( 'name' ) ) );

		if ( '' === $name ) {
			$message = __( 'Enter a name for the bank account.', 'fair-finance' );
			return new WP_Error(
				'rest_invalid_name',
				$message,
				array(
					'status' => 400,
					'params' => array( 'name' => $message ),
				)
			);
		}

		if ( ( function_exists( 'mb_strlen' ) ? mb_strlen( $name ) : strlen( $name ) ) > BankAccount::NAME_MAX_LENGTH ) {
			$message = __( 'Bank account name can be at most 255 characters.', 'fair-finance' );
			return new WP_Error(
				'rest_invalid_name',
				$message,
				array(
					'status' => 400,
					'params' => array( 'name' => $message ),
				)
			);
		}

		$id = BankAccount::create( $name );
		if ( ! $id ) {
			return new WP_Error(
				'rest_bank_account_creation_failed',
				__( 'The bank account could not be created.', 'fair-finance' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( BankAccount::get_by_id( $id )->to_array(), 201 );
	}

	/**
	 * Check permissions for listing bank accounts
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for creating a bank account
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
