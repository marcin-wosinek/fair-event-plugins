<?php
/**
 * Meta Conversions API connector.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Registers the Meta Conversions API access token with WordPress Settings →
 * Connectors and resolves the credential every delivery and test uses.
 *
 * The connector's database credential is the option the plugin has always
 * stored the token in, so a token saved before the move keeps working. An
 * environment variable or PHP constant named {@see self::CREDENTIAL_NAME}
 * takes precedence over it, in that order.
 */
class Connector {
	public const ID              = 'fair-events-meta-conversions';
	public const TYPE            = 'analytics';
	public const CREDENTIAL_NAME = 'FAIR_EVENTS_EXPERIMENTAL_META_ACCESS_TOKEN';
	public const CREDENTIALS_URL = 'https://developers.facebook.com/docs/marketing-api/conversions-api/get-started';
	public const PLUGIN_FILE     = 'fair-events-experimental/fair-events-experimental.php';

	/**
	 * Register the connector and guard writes to its credential.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'wp_connectors_init', array( self::class, 'register' ) );
		// Before core registers its default connector settings at priority 20,
		// which skips settings an owning plugin already registered.
		add_action( 'init', array( self::class, 'register_setting' ), 19 );
		add_filter( 'wp_default_autoload_value', array( self::class, 'autoload' ), 10, 2 );
		add_filter( 'rest_request_before_callbacks', array( self::class, 'reject_malformed_credential' ), 10, 3 );
	}

	/**
	 * Add the connector to the registry.
	 *
	 * @param \WP_Connector_Registry $registry Connector registry.
	 * @return void
	 */
	public static function register( $registry ) {
		$registry->register(
			self::ID,
			array(
				'name'           => __( 'Meta Conversions API', 'fair-events-experimental' ),
				'description'    => self::description(),
				'type'           => self::TYPE,
				'plugin'         => array( 'file' => self::PLUGIN_FILE ),
				'authentication' => self::default_authentication(),
			)
		);
	}

	/**
	 * What the connector does and what removing its token means.
	 *
	 * @return string
	 */
	private static function description() {
		$description = __( 'Report consented checkouts, purchases and event-page button clicks to Meta. Removing the access token stops conversion delivery until another token is saved.', 'fair-events-experimental' );
		$source      = self::credential()['source'];
		if ( 'env' === $source ) {
			/* translators: %s: environment variable name */
			$description .= ' ' . sprintf( __( 'The token in use comes from the %s environment variable, so removing a saved token here does not stop delivery.', 'fair-events-experimental' ), self::CREDENTIAL_NAME );
		} elseif ( 'constant' === $source ) {
			/* translators: %s: PHP constant name */
			$description .= ' ' . sprintf( __( 'The token in use comes from the %s constant, so removing a saved token here does not stop delivery.', 'fair-events-experimental' ), self::CREDENTIAL_NAME );
		}

		return $description;
	}

	/**
	 * Register the credential option, so writes from Connectors are validated.
	 *
	 * @return void
	 */
	public static function register_setting() {
		register_setting(
			'connectors',
			Conversions::TOKEN_OPTION,
			array(
				'type'              => 'string',
				'label'             => __( 'Meta access token', 'fair-events-experimental' ),
				'description'       => __( 'Access token for the Meta Conversions API.', 'fair-events-experimental' ),
				'default'           => '',
				'show_in_rest'      => true,
				'sanitize_callback' => array( self::class, 'sanitize_credential' ),
			)
		);
	}

	/**
	 * Keep a newly saved credential out of the autoloaded options.
	 *
	 * @param bool|null $autoload Default autoload value.
	 * @param string    $option   Option name.
	 * @return bool|null
	 */
	public static function autoload( $autoload, $option ) {
		return Conversions::TOKEN_OPTION === $option ? false : $autoload;
	}

	/**
	 * Whether a value can be a Meta access token.
	 *
	 * Deliberately loose: Meta documents no token format, so this only refuses
	 * what cannot be one — whitespace, non-ASCII characters (such as a masked
	 * value copied back) and values too short or long to be a pasted token.
	 * Only a test event shows whether Meta accepts it.
	 *
	 * @param mixed $value Candidate token.
	 * @return bool
	 */
	public static function valid_token( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^[\x21-\x7E]{20,4096}$/', $value );
	}

	/**
	 * Sanitize a credential on its way into the database.
	 *
	 * An empty value removes the credential. A malformed one keeps the saved
	 * credential, on every write path.
	 *
	 * @param mixed $value Submitted credential.
	 * @return string
	 */
	public static function sanitize_credential( $value ) {
		$value = is_string( $value ) ? trim( sanitize_text_field( $value ) ) : '';
		if ( '' === $value || self::valid_token( $value ) ) {
			return $value;
		}

		return (string) get_option( Conversions::TOKEN_OPTION, '' );
	}

	/**
	 * Refuse a settings request that would save a malformed credential.
	 *
	 * The format is checked locally; Meta is not contacted when saving. The
	 * error never repeats the submitted value.
	 *
	 * @param mixed            $response Current response, usually null.
	 * @param array            $handler  Route handler, unused.
	 * @param \WP_REST_Request $request  Request.
	 * @return mixed
	 */
	public static function reject_malformed_credential( $response, $handler, $request ) {
		unset( $handler );
		if (
			is_wp_error( $response )
			|| '/wp/v2/settings' !== $request->get_route()
			|| 'GET' === $request->get_method()
			|| ! $request->has_param( Conversions::TOKEN_OPTION )
			// Leave everyone else to the route's own permission check.
			|| ! current_user_can( 'manage_options' )
		) {
			return $response;
		}

		$value = $request->get_param( Conversions::TOKEN_OPTION );
		$value = is_string( $value ) ? trim( $value ) : '';
		if ( '' === $value || self::valid_token( $value ) ) {
			return $response;
		}

		return new WP_Error(
			'invalid_access_token',
			__( 'That does not look like a Meta access token. Paste the full token generated in Events Manager, without spaces. The saved token was not changed.', 'fair-events-experimental' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * The credential in effect and where it comes from.
	 *
	 * @return array{token: string, source: string} Source is 'env', 'constant',
	 *     'database' or 'none'.
	 */
	public static function credential() {
		$authentication = self::authentication();

		$name = (string) ( $authentication['env_var_name'] ?? '' );
		if ( '' !== $name ) {
			$value = getenv( $name );
			if ( is_string( $value ) && '' !== trim( $value ) ) {
				return self::resolved( $value, 'env' );
			}
		}

		$name = (string) ( $authentication['constant_name'] ?? '' );
		if ( '' !== $name && defined( $name ) ) {
			$value = constant( $name );
			if ( is_string( $value ) && '' !== trim( $value ) ) {
				return self::resolved( $value, 'constant' );
			}
		}

		$value = get_option( (string) $authentication['setting_name'], '' );
		if ( is_string( $value ) && '' !== trim( $value ) ) {
			return self::resolved( $value, 'database' );
		}

		return self::resolved( '', 'none' );
	}

	/**
	 * The access token in effect, or an empty string.
	 *
	 * @return string
	 */
	public static function token() {
		return self::credential()['token'];
	}

	/**
	 * Credential status for administrators, without the credential itself.
	 *
	 * A configured token may still be rejected by Meta; only a test event
	 * shows that.
	 *
	 * @return array{configured: bool, source: string}
	 */
	public static function status() {
		$source = self::credential()['source'];

		return array(
			'configured' => 'none' !== $source,
			'source'     => $source,
		);
	}

	/**
	 * The Settings → Connectors screen.
	 *
	 * @return string
	 */
	public static function admin_url() {
		return admin_url( 'options-connectors.php' );
	}

	/**
	 * Build a credential result.
	 *
	 * @param string $token  Access token.
	 * @param string $source Where it comes from.
	 * @return array{token: string, source: string}
	 */
	private static function resolved( $token, $source ) {
		return array(
			'token'  => trim( $token ),
			'source' => $source,
		);
	}

	/**
	 * Authentication metadata as registered, read through the public registry
	 * API once the registry exists.
	 *
	 * @return array
	 */
	private static function authentication() {
		$authentication = self::default_authentication();
		if ( function_exists( 'wp_is_connector_registered' ) && wp_is_connector_registered( self::ID ) ) {
			$connector      = wp_get_connector( self::ID );
			$authentication = array_merge( $authentication, (array) ( $connector['authentication'] ?? array() ) );
		}

		return $authentication;
	}

	/**
	 * Authentication metadata the connector registers with.
	 *
	 * @return array
	 */
	private static function default_authentication() {
		return array(
			'method'          => 'api_key',
			'credentials_url' => self::CREDENTIALS_URL,
			'setting_name'    => Conversions::TOKEN_OPTION,
			'constant_name'   => self::CREDENTIAL_NAME,
			'env_var_name'    => self::CREDENTIAL_NAME,
		);
	}
}
