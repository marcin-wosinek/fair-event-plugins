<?php
/**
 * Telegram connector for weekly notifications.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Registers the Telegram bot token with WordPress Settings → Connectors and
 * resolves the credential every send uses.
 *
 * The connector's database credential is the option the plugin has always
 * stored the token in, so a token saved before the move keeps working. An
 * environment variable or PHP constant named {@see self::CREDENTIAL_NAME}
 * takes precedence over it, in that order.
 */
class TelegramConnector {
	public const ID              = 'fair-events-telegram';
	public const TYPE            = 'messaging';
	public const CREDENTIAL_NAME = 'FAIR_EVENTS_EXPERIMENTAL_TELEGRAM_BOT_TOKEN';
	public const CREDENTIALS_URL = 'https://core.telegram.org/bots/features#botfather';
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
				'name'           => __( 'Telegram', 'fair-events-experimental' ),
				'description'    => __( 'Post weekly event summaries to Telegram chats and channels.', 'fair-events-experimental' ),
				'type'           => self::TYPE,
				'plugin'         => array( 'file' => self::PLUGIN_FILE ),
				'authentication' => self::default_authentication(),
			)
		);
	}

	/**
	 * Register the credential option, so writes from Connectors are validated.
	 *
	 * @return void
	 */
	public static function register_setting() {
		register_setting(
			'connectors',
			WeeklyNotificationSettings::TOKEN_OPTION,
			array(
				'type'              => 'string',
				'label'             => __( 'Telegram bot token', 'fair-events-experimental' ),
				'description'       => __( 'Bot token for weekly event notifications on Telegram.', 'fair-events-experimental' ),
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
		return WeeklyNotificationSettings::TOKEN_OPTION === $option ? false : $autoload;
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
		if ( '' === $value || WeeklyNotificationSettings::valid_token( $value ) ) {
			return $value;
		}

		return (string) get_option( WeeklyNotificationSettings::TOKEN_OPTION, '' );
	}

	/**
	 * Refuse a settings request that would save a malformed credential.
	 *
	 * The format is checked locally; Telegram is not contacted when saving.
	 * The error never repeats the submitted value.
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
			|| ! $request->has_param( WeeklyNotificationSettings::TOKEN_OPTION )
			// Leave everyone else to the route's own permission check.
			|| ! current_user_can( 'manage_options' )
		) {
			return $response;
		}

		$value = $request->get_param( WeeklyNotificationSettings::TOKEN_OPTION );
		$value = is_string( $value ) ? trim( $value ) : '';
		if ( '' === $value || WeeklyNotificationSettings::valid_token( $value ) ) {
			return $response;
		}

		return new WP_Error(
			'invalid_bot_token',
			__( 'That does not look like a Telegram bot token. Copy the full token from @BotFather, for example 123456789:AAE…. The saved token was not changed.', 'fair-events-experimental' ),
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
	 * The bot token in effect, or an empty string.
	 *
	 * @return string
	 */
	public static function token() {
		return self::credential()['token'];
	}

	/**
	 * Credential status for administrators, without the credential itself.
	 *
	 * A configured, well-formed token may still be rejected by Telegram; only
	 * a send shows that.
	 *
	 * @return array{configured: bool, valid: bool, source: string}
	 */
	public static function status() {
		$credential = self::credential();

		return array(
			'configured' => 'none' !== $credential['source'],
			'valid'      => WeeklyNotificationSettings::valid_token( $credential['token'] ),
			'source'     => $credential['source'],
		);
	}

	/**
	 * Why a credential cannot be used for a send.
	 *
	 * @param array{token: string, source: string}|null $credential Credential, or null for the one in effect.
	 * @return array{code: string, message: string}|null Null when it is usable.
	 */
	public static function problem( $credential = null ) {
		$credential = null === $credential ? self::credential() : $credential;

		if ( '' === $credential['token'] ) {
			return array(
				'code'    => 'missing_token',
				'message' => __( 'No Telegram bot token is configured. Add one in Settings → Connectors.', 'fair-events-experimental' ),
			);
		}
		if ( WeeklyNotificationSettings::valid_token( $credential['token'] ) ) {
			return null;
		}

		if ( 'env' === $credential['source'] ) {
			/* translators: %s: environment variable name */
			$message = sprintf( __( 'The %s environment variable does not hold a valid Telegram bot token. Correct it where it is set.', 'fair-events-experimental' ), self::CREDENTIAL_NAME );
		} elseif ( 'constant' === $credential['source'] ) {
			/* translators: %s: PHP constant name */
			$message = sprintf( __( 'The %s constant does not hold a valid Telegram bot token. Correct it where it is defined.', 'fair-events-experimental' ), self::CREDENTIAL_NAME );
		} else {
			$message = __( 'The saved Telegram bot token is not a valid bot token. Replace it in Settings → Connectors with the full token from @BotFather.', 'fair-events-experimental' );
		}

		return array(
			'code'    => 'invalid_token',
			'message' => $message,
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
	 * @param string $token  Bot token.
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
			'setting_name'    => WeeklyNotificationSettings::TOKEN_OPTION,
			'constant_name'   => self::CREDENTIAL_NAME,
			'env_var_name'    => self::CREDENTIAL_NAME,
		);
	}
}
