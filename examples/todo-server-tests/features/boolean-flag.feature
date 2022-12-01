Feature: Checks boolean flag

  @FEATURE_TITLE_TO_UPPERCASE @bool @bool1
  Scenario: Check boolean flag on
    # This hook is called before and after the scenario to tidy up the feature state so it doesn't affect other tests
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "Buy eggs"
    Then my list of todos should contain "BUY EGGS"

  @FEATURE_TITLE_TO_UPPERCASE_OFF @booloff @bool
  Scenario: Check boolean flag off
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "Buy eggs"
    Then my list of todos should contain "Buy eggs"

  @bool
  Scenario: Check boolean flag lock function
    Given I lock the feature "FEATURE_TITLE_TO_UPPERCASE"
    When I attempt to update feature "FEATURE_TITLE_TO_UPPERCASE" to boolean value "false"
    Then I should not be able to update the value

  @bool
  Scenario: Check boolean flag cannot be updated with string values
    Given I set the flag "FEATURE_TITLE_TO_UPPERCASE" to "foo"
    Then I should not be able to update the value
