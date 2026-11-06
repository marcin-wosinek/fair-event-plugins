<?php
/**
 * Test doubles for the shared API token classes and their plugin adapters.
 *
 * Loaded by both Fair Payments Connector's and its Experimental companion's
 * PHPUnit suites. Every stub is guarded, so either bootstrap's own stubs win.
 *
 * @package FairPaymentsConnector
 */

// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound, Universal.Files.SeparateFunctionsFromOO.Mixed, Squiz.Commenting.FunctionComment.Missing, Squiz.Commenting.ClassComment.Missing, Squiz.Commenting.VariableComment.Missing -- small test doubles that belong together.

require_once dirname( __DIR__ ) . '/Fair_Test_WP_Error.php';
require_once dirname( __DIR__ ) . '/Fair_Test_WP_REST.php';

if ( ! class_exists( 'WP_REST_Server' ) ) {
	class WP_REST_Server {
		const READABLE  = 'GET';
		const CREATABLE = 'POST';
		const DELETABLE = 'DELETE';
	}
}

if ( ! function_exists( 'register_rest_route' ) ) {
	/**
	 * Records each route in $GLOBALS['_fair_test_rest_routes'].
	 *
	 * @param string $route_namespace Namespace.
	 * @param string $route           Route.
	 * @param array  $args            Handlers.
	 * @return bool
	 */
	function register_rest_route( $route_namespace, $route, $args = array() ) {
		$GLOBALS['_fair_test_rest_routes'][ '/' . $route_namespace . $route ] = $args;
		return true;
	}
}

if ( ! function_exists( 'current_user_can' ) ) {
	function current_user_can( $capability ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found
		return ! empty( $GLOBALS['_fair_test_current_user_can'] );
	}
}

if ( ! function_exists( 'wp_generate_password' ) ) {
	function wp_generate_password( $length = 12 ) {
		$char = empty( $GLOBALS['_fair_test_password_chars'] ) ? 'a' : array_shift( $GLOBALS['_fair_test_password_chars'] );
		return str_repeat( $char, $length );
	}
}

if ( ! function_exists( 'wp_json_encode' ) ) {
	function wp_json_encode( $data ) {
		return json_encode( $data ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- this stub is the wrapper.
	}
}

if ( ! function_exists( 'get_permalink' ) ) {
	function get_permalink( $post_id ) {
		return 'https://example.test/?p=' . (int) $post_id;
	}
}

/**
 * Request double carrying headers and writable params.
 */
class Fair_Test_Api_Token_Request extends WP_REST_Request {
	private $headers;

	private $values;

	public function __construct( array $params = array(), array $headers = array() ) {
		parent::__construct();
		$this->values  = $params;
		$this->headers = array_change_key_case( $headers );
	}

	public function get_param( $key ) {
		return $this->values[ $key ] ?? null;
	}

	public function set_param( $key, $value ) {
		$this->values[ $key ] = $value;
	}

	public function get_header( $key ) {
		return $this->headers[ strtolower( $key ) ] ?? null;
	}
}

/**
 * In-memory `$wpdb` for the API tokens table, understanding exactly the
 * queries AbstractApiToken issues.
 */
class Fair_Test_Api_Token_WPDB {
	public $prefix = 'wp_';

	public $insert_id = 0;

	public $fail_insert = false;

	/**
	 * Rows by table name, then ID.
	 *
	 * @var array<string,array<int,array>>
	 */
	public $tables = array();

	/**
	 * Tables each query touched, in order.
	 *
	 * @var string[]
	 */
	public $touched = array();

	public function prepare( $query, ...$args ) {
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	public function insert( $table, $data, $format = null ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		$this->touched[] = $table;
		if ( $this->fail_insert ) {
			return false;
		}

		++$this->insert_id;
		$this->tables[ $table ][ $this->insert_id ] = array_merge(
			array(
				'id'           => (string) $this->insert_id,
				'last_used_at' => null,
				'revoked_at'   => null,
			),
			$data
		);

		return 1;
	}

	public function get_row( $prepared ) {
		list( $table, $value ) = $prepared['args'];
		$this->touched[]       = $table;

		foreach ( $this->tables[ $table ] ?? array() as $row ) {
			if ( false !== strpos( $prepared['query'], 'token_hash = %s' ) ) {
				if ( $row['token_hash'] === $value && null === $row['revoked_at'] ) {
					return (object) $row;
				}
			} elseif ( (int) $row['id'] === (int) $value ) {
				return (object) $row;
			}
		}

		return null;
	}

	public function get_results( $prepared ) {
		$table           = $prepared['args'][0];
		$this->touched[] = $table;
		$rows            = array_values( $this->tables[ $table ] ?? array() );

		usort(
			$rows,
			static function ( $a, $b ) {
				$by_date = strcmp( $b['created_at'], $a['created_at'] );
				return 0 !== $by_date ? $by_date : (int) $b['id'] - (int) $a['id'];
			}
		);

		return array_map(
			static function ( $row ) {
				return (object) $row;
			},
			$rows
		);
	}

	public function update( $table, $data, $where, $format = null, $where_format = null ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		$this->touched[] = $table;
		$id              = (int) $where['id'];
		if ( ! isset( $this->tables[ $table ][ $id ] ) ) {
			return 0;
		}

		$this->tables[ $table ][ $id ] = array_merge( $this->tables[ $table ][ $id ], $data );

		return 1;
	}
}
