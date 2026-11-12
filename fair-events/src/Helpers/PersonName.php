<?php
/**
 * Complete name of a registrant
 *
 * A signup stores its name and optional surname separately (#2215). Older
 * signups hold everything the registrant typed in the name, with an empty
 * surname; they are never split. Every place that shows a whole name joins
 * the two components here, once.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

defined( 'WPINC' ) || die;

/**
 * Joins name components into the complete name.
 */
class PersonName {

	/**
	 * The complete name: the name, then the surname when there is one.
	 *
	 * @param string|null $name    Name (given name, or the whole name of an older signup).
	 * @param string|null $surname Surname; empty when none was given.
	 * @return string
	 */
	public static function full( $name, $surname = '' ) {
		$name    = trim( (string) $name );
		$surname = trim( (string) $surname );

		if ( '' === $surname ) {
			return $name;
		}
		if ( '' === $name ) {
			return $surname;
		}
		return $name . ' ' . $surname;
	}

	/**
	 * The complete name stored on a signup row.
	 *
	 * @param object|array|null $signup Signup row.
	 * @return string
	 */
	public static function of_signup( $signup ) {
		$signup = (object) $signup;
		return self::full( $signup->name ?? '', $signup->surname ?? '' );
	}
}
