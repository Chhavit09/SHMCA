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
        if (distance >= 15.0) 
            return SAFE;
        else if (distance >= 10.0) 
            return WARNING;
        else if (distance >= 5.0) 
            return DANGER;
        else 
            return CRITICAL;
    }
    
    //  GET RISK NAME
    string getRiskName(RiskLevel risk) {
        if (risk == SAFE)
            return "SAFE";
        if (risk == WARNING)
            return "WARNING";
        if (risk == DANGER) 
            return "DANGER";
        return "CRITICAL";
    }

    //  AUTOMATIC COLLISION DECISION
    // OOP Unit 2: Passing objects as arguments

    void handleCollisionThreat(Satellite *sat, Debris *debris, double distance, 
        ofstream &logFile, double simTime) {
        if (sat == NULL || debris == NULL) 
            return;
        if (sat->isDisabled()) 
            return;

        RiskLevel risk = checkCollisionRisk(distance);

        if (risk == SAFE) 
            return;

        if (risk == WARNING) {
            cout << "[WARNING] " << sat->getName() << " -> Debris #" << debris->id << " Distance: " << distance << endl;
            logFile << "[t=" << simTime << "s] [WARNING] " << sat->getName() << " debris #" << 
                debris->id << " distance=" << distance << "\n";
            return;
        }

        cout << "\n!! COLLISION ALERT !!" << endl;
        cout << "Satellite : " << sat->getName() << endl;
        cout << "Debris    : #" << debris->id << endl;
        cout << "Distance  : " << distance << endl;
        cout << "Risk      : " << getRiskName(risk) << endl;
        logFile << "[t=" << simTime << "s] [COLLISION ALERT] " << sat->getName() << " debris #" << 
            debris->id << " distance=" << distance << " risk=" << getRiskName(risk) << "\n";
        
        // CHECKING THRUSTER CONDITION
        if (!sat->isThrusterOk()) {
            cout << "ACTION: Thruster unavailable!\nACTION: Satellite sent for repair.\n";
            logFile << "[t=" << simTime << "s] [DECISION] " << sat->getName() 
                << " thruster unavailable - repair required\n";
            sat->sendForRepair(logFile, simTime, "thruster failure during collision threat");
            return;
        }

        // CHECKING FUEL STATUS
        if (!sat->useFuel(2.5)) {
            cout << "ACTION: Insufficient fuel!\nACTION: Satellite sent for repair.\n";
            logFile << "[t=" << simTime << "s] [DECISION] " << sat->getName() << " insufficient fuel for evasive maneuver\n";
            sat->sendForRepair(logFile, simTime, "out of propellant");
            return;
        }

        
    // EVASIVE BURN
        
        Vector3 satellitePosition = sat->getPos();
        Vector3 debrisPosition = debris->pos;
        Vector3 relativePosition = debrisPosition - satellitePosition;
        double magnitude = dist3D(satellitePosition, debrisPosition);
        Vector3 direction(0, 0, 1);
        if (magnitude > 0.001) {
            direction = relativePosition * (-1.0 / magnitude);
        }
        Vector3 burnAmount = direction * 0.08;
        sat->burn(burnAmount);
        cout << "ACTION: EVASIVE BURN ACTIVATED\nACTION: Satellite velocity changed\nFUEL USED: 2.5 kg\n";
        logFile << "[t=" << simTime << "s] [DECISION] " << sat->getName() << " performed evasive burn against debris #" << 
            debris->id << " fuel=2.5kg\n";
    }

    // HEALTH DECISION FUNCTION
    void handleHealthDecision(Satellite *sat, ofstream &logFile, double simTime) {
        if (sat == NULL) 
            return;
        if (sat->isDisabled())
            return;

    // CHECKING SENSOR STATUS
    if (!sat->areSensorsOk()) {
        cout << "\n[HEALTH ALERT] " << sat->getName() << " sensor fault detected." << endl;
        logFile << "[t=" << simTime << "s] [HEALTH] " << sat->getName() << " sensor fault detected\n";
        sat->sendForRepair(logFile, simTime, "sensor hardware fault");
        return;
    }

   // Checks thruster
    if (!sat->isThrusterOk()) {
        cout << "\n[HEALTH ALERT] " << sat->getName() << " thruster failure detected." << endl;
        logFile << "[t=" << simTime << "s] [HEALTH] " << sat->getName() << " thruster failure detected\n";
        sat->sendForRepair(logFile, simTime, "thruster burnout");
        return;
    }

    // OOP Unit 4: Calling a Virtual function
    sat->runDiagnostics(logFile, simTime);
    }
};
