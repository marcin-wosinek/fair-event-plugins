<?php
/**
 * Resolution of a connector credential from its override and saved sources.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Security;

defined( 'WPINC' ) || die;

/**
 * Picks the credential in effect: an environment variable, then a PHP
 * constant, then a saved WordPress option, in that order.
 *
 * Each source counts only when it holds a non-empty string after trimming;
 * a missing, non-string, empty or whitespace-only value falls through to the
 * next one. The saved option is read only when neither override supplies a
 * credential. Provider-specific validation stays with the caller: a
 * malformed but non-empty override still wins.
 */
final class CredentialResolver {
	const SOURCE_ENV      = 'env';
	const SOURCE_CONSTANT = 'constant';
	const SOURCE_DATABASE = 'database';
	const SOURCE_NONE     = 'none';

	/**
	 * The credential in effect and where it comes from.
	 *
	 * An empty name skips that source.
	 *
	 * @param string $env_var_name  Environment variable name.
	 * @param string $constant_name PHP constant name.
	 * @param string $option_name   WordPress option name.
	 * @return array{token: string, source: string} Source is 'env',
	 *     'constant', 'database' or 'none'.
	 */
	public static function resolve( $env_var_name, $constant_name, $option_name ) {
		$env_var_name = (string) $env_var_name;
		if ( '' !== $env_var_name ) {
			$value = self::usable( getenv( $env_var_name ) );
			if ( null !== $value ) {
				return self::result( $value, self::SOURCE_ENV );
			}
		}

		$constant_name = (string) $constant_name;
		if ( '' !== $constant_name && defined( $constant_name ) ) {
			$value = self::usable( constant( $constant_name ) );
			if ( null !== $value ) {
				return self::result( $value, self::SOURCE_CONSTANT );
			}
		}

		$option_name = (string) $option_name;
		if ( '' !== $option_name ) {
			$value = self::usable( get_option( $option_name, '' ) );
			if ( null !== $value ) {
				return self::result( $value, self::SOURCE_DATABASE );
			}
		}

		return self::result( '', self::SOURCE_NONE );
	}

	/**
	 * Credential status for administrators, without the credential itself.
	 *
	 * @param string $source Source returned by {@see self::resolve()}.
	 * @return array{configured: bool, source: string}
	 */
	public static function status( $source ) {
		$source = (string) $source;

		return array(
			'configured' => self::SOURCE_NONE !== $source,
			'source'     => $source,
		);
	}

	/**
	 * A source value trimmed, or null when it cannot supply a credential.
	 *
	 * @param mixed $value Raw source value.
	 * @return string|null
	 */
	private static function usable( $value ) {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = trim( $value );

		return '' === $value ? null : $value;
	}

	/**
	 * Build a resolution result.
	 *
	 * @param string $token  Trimmed credential, or ''.
	 * @param string $source Where it comes from.
	 * @return array{token: string, source: string}
	 */
	private static function result( $token, $source ) {
		return array(
			'token'  => $token,
			'source' => $source,
		);
	}
}
