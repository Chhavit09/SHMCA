#pragma once
#include <iostream>
#include <fstream>
#include <cmath>
using namespace std;

// OOP Unit 2: Classes & Objects

enum RiskLevel {
    SAFE,
    WARNING,
    DANGER,
    CRITICAL
};

class FlightComputer {
public:
    //  COLLISION RISK CLASSIFICATION
    RiskLevel checkCollisionRisk(double distance) {
        if (distance >= 15.0) return SAFE;
        else if (distance >= 10.0) return WARNING;
        else if (distance >= 5.0) return DANGER;
        else return CRITICAL;
    }