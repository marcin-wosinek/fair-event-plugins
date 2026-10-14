<?php
/**
 * Stand-in for Fair Events' weekly email renderer.
 *
 * Loaded only in a separate process: once declared, every later render in
 * the same process would delegate to it.
 *
 * @package FairAudience
 */

namespace FairEvents\Notifications;

// phpcs:disable Generic.Classes.DuplicateClassName.Found -- stands in for the Fair Events class.

/**
 * Records what the digest renderer hands over.
 */
class WeeklyEmailRenderer {

	/**
	 * Calls as [method, arguments].
	 *
	 * @var array[]
	 */
	public static $calls = array();

	/**
	 * Subject.
	 *
	 * @param string $template Template.
	 * @param array  $week     Week boundaries.
	 * @return string
	 */
	public static function subject( $template, array $week ) {
		self::$calls[] = array( 'subject', array( $template, $week ) );
		return 'shared subject';
	}

	/**
	 * Body.
	 *
	 * @param array  $events Week.
	 * @param string $intro  Intro.
	 * @param string $outro  Outro.
	 * @return string
	 */
	public static function body( array $events, $intro = '', $outro = '' ) {
		self::$calls[] = array( 'body', array( $events, $intro, $outro ) );
		return 'shared body';
	}
}
